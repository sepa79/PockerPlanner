const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const root = path.resolve(__dirname, '..');
const renderer = path.join(root, 'deploy/hiveforge/planner/ansible/render.yml');
const template = path.join(root, 'deploy/hiveforge/planner/ansible/templates/stack.yml.j2');
const integration = path.join(root, 'tests/compose.pockethive-integration.yaml');
const configurationNames = [
  'POCKETPLANNER_IMAGE', 'POCKETPLANNER_PORT', 'POCKETPLANNER_NODE',
  'POCKETPLANNER_INSTANCE_ID', 'POCKETHIVE_BASE_URL', 'POCKETHIVE_PUBLIC_URL',
  'POCKETHIVE_AUTH_BASE_URL', 'POCKETHIVE_ALLOW_REMOTE_HTTP', 'POCKETHIVE_PLANNER_BASE_URL', 'POCKETPLANNER_MCP_ALLOWED_HOSTS',
  'POCKETPLANNER_MCP_ALLOWED_ORIGINS', 'HIVEFORGE_PROFILE', 'HIVEFORGE_BIND_SOURCE_DIR',
];
const optionalValues = {
  POCKETPLANNER_INSTANCE_ID: 'deployment-qa',
  POCKETHIVE_BASE_URL: 'http://ph-ingress:8088',
  POCKETHIVE_PUBLIC_URL: 'https://ph.example.test',
  POCKETHIVE_AUTH_BASE_URL: 'http://ph-ingress:8088/auth-service',
  POCKETPLANNER_MCP_ALLOWED_HOSTS: 'planner.example.test,planner.example.test:8765',
  POCKETPLANNER_MCP_ALLOWED_ORIGINS: 'https://planner.example.test',
};

function environment(values = {}) {
  const result = {...process.env};
  for (const name of configurationNames) delete result[name];
  return {...result, ...values};
}

function run(command, argumentsList, values, expectedStatus = 0) {
  const result = spawnSync(command, argumentsList, {
    cwd: root, env: environment(values), encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
  return result.stdout;
}

function compose(file, values = {}, project = 'planner-config-qa', additionalFiles = []) {
  return JSON.parse(run('docker', [
    'compose', '--env-file', '/dev/null', '--project-name', project,
    '--file', file, ...additionalFiles.flatMap(value => ['--file', value]),
    'config', '--format', 'json',
  ], values));
}

function isolated(action) {
  const directory = mkdtempSync(path.join(tmpdir(), 'planner-deployment-config-'));
  try { return action(directory); } finally { rmSync(directory, {recursive: true, force: true}); }
}

function assertRuntime(service) {
  assert.equal(service.user, '10001:10001');
  assert.equal(service.read_only, true);
  assert.deepEqual(service.cap_drop, ['ALL']);
  assert.deepEqual(service.tmpfs, ['/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777']);
  assert.equal(service.environment.BIND_ADDRESS, '0.0.0.0');
  assert.equal(service.environment.PORT, '8765');
  assert.equal(service.environment.TESTPLANNER_DB, '/data/planner.sqlite3');
  assert.deepEqual(service.healthcheck.test, [
    'CMD', 'curl', '--fail', '--silent', '--show-error', '--max-time', '3',
    'http://127.0.0.1:8765/health',
  ]);
  assert.equal(service.deploy.replicas, 1);
  assert.equal(service.deploy.update_config.order, 'stop-first');
  assert.equal(service.deploy.rollback_config.order, 'stop-first');
  assert.equal(service.volumes.length, 1);
  assert.equal(service.volumes[0].target, '/data');
  assert.equal(service.volumes[0].read_only, undefined);
  for (const name of Object.keys(service.environment)) assert.doesNotMatch(name, /REDIRECT|CALLBACK/);
}

function assertOptional(service, values) {
  assert.equal(service.environment.POCKETHIVE_ALLOW_REMOTE_HTTP, values.POCKETHIVE_ALLOW_REMOTE_HTTP || 'false');
  for (const name of Object.keys(optionalValues)) {
    assert.equal(service.environment[name], values[name] || '', name);
  }
}

function renderHiveForge(directory, values, expectedStatus = 0) {
  const stack = path.join(directory, 'stack.yml');
  const playbook = path.join(directory, 'render.json');
  writeFileSync(playbook, JSON.stringify([{
    hosts: 'localhost', gather_facts: false, tasks: [
      {'ansible.builtin.import_tasks': renderer},
      {
        name: 'Render only into the isolated test directory',
        'ansible.builtin.template': {src: template, dest: stack, mode: '0600'},
        tags: ['configuration'],
      },
    ],
  }]));
  run('ansible-playbook', ['--inventory', 'localhost,', '--connection', 'local',
    '--tags', 'configuration', playbook], {
    ANSIBLE_LOCAL_TEMP: path.join(directory, 'controller'),
    ANSIBLE_REMOTE_TEMP: path.join(directory, 'remote'),
    ANSIBLE_NOCOLOR: '1',
    HIVEFORGE_PROFILE: 'swarm',
    HIVEFORGE_BIND_SOURCE_DIR: '/srv/hf-configuration-qa',
    POCKETPLANNER_IMAGE: 'pocketplanner-local:dev',
    POCKETPLANNER_PORT: '9876',
    POCKETPLANNER_NODE: 'qa-node',
    ...values,
  }, expectedStatus);
  return stack;
}

test('standalone configuration requires an explicitly selected Java image', () => {
  const output = run('docker', ['compose', '--env-file', '/dev/null', '--file',
    'compose.yaml', 'config', '--quiet'], {}, 1);
  assert.equal(output, '');
  const document = compose('compose.yaml', {POCKETPLANNER_IMAGE: 'pocketplanner-local:dev', ...optionalValues});
  assert.deepEqual(Object.keys(document.services), ['pocketplanner']);
  assertRuntime(document.services.pocketplanner);
  assertOptional(document.services.pocketplanner, optionalValues);
  assert.equal(document.services.pocketplanner.image, 'pocketplanner-local:dev');
  assert.equal(document.services.pocketplanner.volumes[0].source, 'planner_data');
});

test('local configuration uses a fresh project-specific Java volume and loopback random port', () => {
  const first = compose('compose.local.yaml', {POCKETPLANNER_PORT: '0'}, 'planner-java-config-first');
  const second = compose('compose.local.yaml', {POCKETPLANNER_PORT: '0'}, 'planner-java-config-second');
  const service = first.services.pocketplanner;
  assert.deepEqual(Object.keys(first.services), ['pocketplanner']);
  assertRuntime(service);
  assertOptional(service, {});
  assert.equal(service.image, 'pocketplanner-local:dev');
  assert.equal(service.build.context, root);
  assert.equal(service.ports[0].host_ip, '127.0.0.1');
  assert.equal(service.ports[0].published, '0');
  assert.equal(service.volumes[0].source, 'planner_java_data');
  assert.notEqual(first.volumes.planner_java_data.name, second.volumes.planner_java_data.name);
  assert.equal(first.volumes.planner_java_data.name, 'planner-java-config-first_planner_java_data');
  assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
});

for (const file of ['compose.yaml', 'compose.local.yaml']) {
  test(`${file} forwards the explicit public HTTP permission`, () => {
    const document = compose(file, {POCKETPLANNER_IMAGE: 'pocketplanner-local:dev', POCKETHIVE_ALLOW_REMOTE_HTTP: 'true'});
    assertOptional(document.services.pocketplanner, {POCKETHIVE_ALLOW_REMOTE_HTTP: 'true'});
  });
}

test('local configuration forwards explicit PH settings and selected image', () => {
  const document = compose('compose.local.yaml', {
    ...optionalValues, POCKETPLANNER_IMAGE: 'pocketplanner-qa:dev', POCKETPLANNER_PORT: '9876',
  });
  assertOptional(document.services.pocketplanner, optionalValues);
  assert.equal(document.services.pocketplanner.image, 'pocketplanner-qa:dev');
  assert.equal(document.services.pocketplanner.ports[0].published, '9876');
});

for (const [label, values] of [['configured', optionalValues], ['view-only', {}],
  ['explicit remote HTTP', {...optionalValues, POCKETHIVE_ALLOW_REMOTE_HTTP: 'true'}]]) {
  test(`HiveForge renders a valid ${label} Java Swarm artifact without changing host storage`, () => isolated(directory => {
    const stack = renderHiveForge(directory, values);
    run('docker', ['stack', 'config', '--compose-file', stack], {});
    const document = compose(stack);
    const service = document.services.pocketplanner;
    assertRuntime(service);
    assertOptional(service, values);
    assert.equal(service.image, 'pocketplanner-local:dev');
    assert.equal(service.volumes[0].type, 'bind');
    assert.equal(service.volumes[0].source, '/srv/hf-configuration-qa/state/pocketplanner');
    assert.equal(service.ports[0].published, '9876');
    assert.equal(service.ports[0].mode, 'ingress');
    assert.deepEqual(service.deploy.placement.constraints, ['node.hostname == qa-node']);
    assert.doesNotMatch(readFileSync(stack, 'utf8'), /security_opt|python|auth\/callback/);
  }));
}

for (const [label, values] of [
  ['a missing image', {POCKETPLANNER_IMAGE: ''}],
  ['a non-integral port', {POCKETPLANNER_PORT: '8765.5'}],
  ['an unsupported profile', {HIVEFORGE_PROFILE: 'docker-single'}],
  ['an invalid public transport permission', {POCKETHIVE_ALLOW_REMOTE_HTTP: 'sometimes'}],
]) {
  test(`HiveForge rejects ${label} before rendering or touching storage`, () => isolated(directory => {
    renderHiveForge(directory, values, 2);
  }));
}

test('PH integration override uses device auth, a Java health check and separate synthetic storage', () => isolated(directory => {
  const base = path.join(directory, 'ph-base.json');
  const services = {};
  for (const name of ['auth-service', 'clickhouse', 'network-proxy-manager', 'postgres',
    'rabbitmq', 'scenario-manager', 'toxiproxy', 'ui', 'orchestrator', 'artemis',
    'wiremock', 'tcp-mock-server', 'tcp-mock-server-tls']) {
    services[name] = {image: 'fixture-not-started:dev', healthcheck: {test: ['CMD', 'true']}};
  }
  const infrastructureVolumes = [
    ['postgres', '/var/lib/postgresql/data', 'ph-java-qa-postgres'],
    ['clickhouse', '/var/lib/clickhouse', 'ph-java-qa-clickhouse'],
    ['rabbitmq', '/var/lib/rabbitmq', 'ph-java-qa-rabbitmq'],
    ['artemis', '/var/lib/artemis-instance', 'ph-java-qa-artemis'],
  ];
  const volumes = {};
  for (const [name, target] of infrastructureVolumes) {
    const source = `synthetic-base-${name}`;
    services[name].volumes = [`${source}:${target}`];
    volumes[source] = {};
  }
  for (const name of ['orchestrator', 'scenario-manager']) {
    services[name].volumes = [
      '${POCKETHIVE_SCENARIOS_RUNTIME_ROOT:-/synthetic-base/scenarios-runtime}:/app/scenarios-runtime',
    ];
  }
  services.orchestrator.environment = {POCKETHIVE_SCENARIOS_RUNTIME_ROOT: '/synthetic-base/scenarios-runtime'};
  writeFileSync(base, JSON.stringify({services, volumes}));
  const integrationValues = {
    POCKETHIVE_BROWSER_URL: 'http://localhost:8089',
    POCKETHIVE_SCENARIOS_RUNTIME_ROOT: '/synthetic-shell/scenarios-runtime',
  };
  const document = compose(base, integrationValues,
    'planner-integration-config-qa', [integration]);
  const service = document.services.planner;
  assertRuntime(service);
  assert.equal(service.environment.POCKETHIVE_AUTH_BASE_URL, 'http://ui:8088/auth-service');
  assert.equal(service.environment.POCKETHIVE_BASE_URL, 'http://ui:8088');
  assert.equal(service.environment.POCKETHIVE_PUBLIC_URL, 'http://localhost:8089');
  assert.equal(service.image, 'pocketplanner-local:dev');
  assert.equal(service.volumes[0].source, 'planner-java-integration-data');
  for (const [name, target, source] of infrastructureVolumes) {
    const mounts = document.services[name].volumes.filter(mount => mount.type === 'volume');
    assert.deepEqual(mounts.map(mount => [mount.source, mount.target]), [[source, target]], name);
    assert.equal(mounts[0].read_only, undefined, name);
    assert.equal(document.volumes[source].name, `planner-integration-config-qa_${source}`, name);
    assert.equal(document.volumes[source].external, undefined, name);
  }
  const orchestrator = document.services.orchestrator;
  assert.equal(orchestrator.environment.POCKETHIVE_PLANNER_BASE_URL, 'http://planner:8765');
  assert.equal(orchestrator.depends_on?.planner, undefined);
  assert.equal(orchestrator.depends_on.artemis.condition, 'service_healthy');
  const operatorUrl = 'http://host.docker.internal:8765';
  const overridden = compose(base, {...integrationValues, POCKETHIVE_PLANNER_BASE_URL: operatorUrl},
    'planner-integration-config-qa', [integration]);
  assert.equal(overridden.services.orchestrator.environment.POCKETHIVE_PLANNER_BASE_URL, operatorUrl);
  assert.equal(overridden.services.orchestrator.depends_on?.planner, undefined);
  const runtimeRoot = orchestrator.environment.POCKETHIVE_SCENARIOS_RUNTIME_ROOT;
  assert.equal(runtimeRoot, '/tmp/pocketplanner-ph-integration-runtime');
  for (const name of ['orchestrator', 'scenario-manager']) {
    const mounts = document.services[name].volumes.filter(mount => mount.target === '/app/scenarios-runtime');
    assert.equal(mounts.length, 1, name);
    assert.equal(mounts[0].type, 'bind', name);
    assert.equal(mounts[0].source, runtimeRoot, name);
    assert.equal(mounts[0].read_only, undefined, name);
  }
  const scenarioMounts = document.services['scenario-manager'].volumes;
  for (const name of ['capabilities', 'network', 'sut']) {
    const mounts = scenarioMounts.filter(mount => mount.target === `/app/${name}`);
    assert.equal(mounts.length, 1, name);
    assert.equal(mounts[0].type, 'bind', name);
    assert.equal(mounts[0].source, path.join(directory, 'scenario-manager-service', name), name);
    assert.equal(mounts[0].read_only, true, name);
  }
  const scenarios = scenarioMounts.find(mount => mount.target === '/app/scenarios');
  assert.equal(scenarios?.type, 'bind');
  assert.equal(scenarios.source, path.join(directory, 'scenarios'));
  assert.equal(scenarios.read_only, undefined);
  const socket = orchestrator.volumes.find(mount => mount.target === '/var/run/docker.sock');
  assert.equal(socket?.type, 'bind');
  assert.equal(socket.source, '/var/run/docker.sock');
  assert.equal(socket.read_only, undefined);
  assert.equal(document.services['auth-service'].environment.POCKETHIVE_AUTH_WEB_PP_REDIRECT_URI, undefined);
  assert.equal(document.services['auth-service'].environment.POCKETHIVE_AUTH_WEB_PH_REDIRECT_URI,
    'http://localhost:8089/auth/callback');
}));

test('CI builds the actual Java and React product and gates publishing on push and VERSION', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/container.yaml'), 'utf8');
  assert.match(workflow, /java-version: "21"/);
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /bash scripts\/build-java\.sh/);
  assert.match(workflow, /node --test tests\/deployment\.test\.cjs/);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /version="\$\(cat VERSION\)"/);
  assert.match(workflow, /"\$\{GITHUB_REF_NAME\}" == "v\$\{version\}"/);
  assert.match(workflow, /push: \$\{\{ github\.event_name == 'push' \}\}/);
  assert.doesNotMatch(workflow, /setup-python|requirements\.txt|planner_version|web\/|unittest/);
});

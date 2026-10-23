const fs = require('node:fs');
const path = require('node:path');
const {execFile, execFileSync} = require('node:child_process');
const {promisify} = require('node:util');
const {randomUUID} = require('node:crypto');
const assert = require('node:assert/strict');

const execute = promisify(execFile);

class ContainerFixture {
  constructor(directory, image, instance, auth) {
    this.root = path.resolve(__dirname, '../..');
    this.project = 'pp-container-qa-' + randomUUID().slice(0, 8);
    this.image = image;
    this.instance = instance;
    this.auth = auth;
    this.config = path.join(directory, 'compose-qa.json');
    this.gateway = execFileSync('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], {encoding: 'utf8'}).trim();
    assert.match(this.gateway, /^\d+\.\d+\.\d+\.\d+$/);
  }

  async compose(...arguments_) {
    const result = await execute('docker', ['compose', '--env-file', '/dev/null', '--project-directory', this.root, '-p', this.project,
      '-f', path.join(this.root, 'compose.local.yaml'), '-f', this.config, ...arguments_], {
      env: {...process.env, POCKETPLANNER_IMAGE: this.image, POCKETPLANNER_PORT: '0'}, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trim();
  }

  configure(port) {
    assert.ok(Number.isInteger(port) && port > 0);
    fs.writeFileSync(this.config, JSON.stringify({services: {pocketplanner: {
      image: this.image,
      environment: {
        POCKETPLANNER_INSTANCE_ID: this.instance,
        POCKETHIVE_AUTH_BASE_URL: process.env.POCKETPLANNER_TEST_CONTAINER_AUTH || 'http://ui:8088/auth-service',
        POCKETHIVE_BASE_URL: 'http://host.docker.internal:' + port,
        POCKETHIVE_PUBLIC_URL: new URL(this.auth).origin,
      },
      networks: ['default', 'ph'],
      healthcheck: {interval: '2s', timeout: '5s', retries: 30, start_period: '10s'},
    }}, networks: {ph: {external: true, name: process.env.POCKETPLANNER_TEST_PH_NETWORK || 'pp-ph-integration'}}}));
  }

  async start() {
    await this.compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '90');
    const identifier = await this.compose('ps', '-q', 'pocketplanner');
    const result = await execute('docker', ['inspect', identifier], {maxBuffer: 1024 * 1024});
    const inspected = JSON.parse(result.stdout)[0];
    assert.equal(inspected.Config.User, '10001:10001');
    assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
    assert.ok(inspected.HostConfig.CapDrop.includes('ALL'));
    assert.ok(inspected.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    const volume = inspected.Mounts.find(mount => mount.Destination === '/data');
    assert.equal(volume.Type, 'volume');
    assert.ok(volume.Name.startsWith(this.project + '_'));
    assert.equal(inspected.State.Health.Status, 'healthy');
    await execute('docker', ['exec', identifier, 'sh', '-c', 'test "$(id -u)" = 10001 && ! command -v python && ! command -v node']);
    const binding = inspected.NetworkSettings.Ports['8765/tcp'][0];
    assert.equal(binding.HostIp, '127.0.0.1');
    return {origin: 'http://localhost:' + binding.HostPort, stop: () => this.compose('down', '--timeout', '10')};
  }

  async destroy() {
    if (fs.existsSync(this.config)) await this.compose('down', '--volumes', '--timeout', '10');
  }
}

module.exports = {ContainerFixture};

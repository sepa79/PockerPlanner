export function IdentityButton({ username, configured, loading, signingIn, locked, signIn, signOut, cancelSignIn }: {
  username: string | null; configured: boolean; loading: boolean; signingIn: boolean; locked: boolean
  signIn: () => unknown; signOut: () => unknown; cancelSignIn: () => unknown
}) {
  return <button id="auth-button" type="button" disabled={locked || loading || (!configured && !username)}
    onClick={() => { if (signingIn) cancelSignIn(); else if (username) void signOut(); else void signIn() }}
    title={configured ? 'PocketHive session' : 'Set POCKETHIVE_AUTH_BASE_URL to enable sign in'}>
    {loading ? 'Checking session…' : signingIn ? 'Waiting for PH · Cancel' : username ? `${username} · Sign out` : 'View only · Sign in'}
  </button>
}

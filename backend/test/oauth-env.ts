// A plain OAuth2 provider (GitHub-like, manual endpoints) for the whole file
Object.assign(process.env, {
  OIDC_PROVIDERS: 'github',
  OIDC_GITHUB_DISPLAY_NAME: 'GitHub',
  OIDC_GITHUB_CLIENT_ID: 'client-id',
  OIDC_GITHUB_CLIENT_SECRET: 'client-secret',
  OIDC_GITHUB_AUTHORIZATION_ENDPOINT: 'https://github.example/login/oauth/authorize',
  OIDC_GITHUB_TOKEN_ENDPOINT: 'https://github.example/login/oauth/access_token',
  OIDC_GITHUB_USERINFO_ENDPOINT: 'https://api.github.example/user',
  OIDC_GITHUB_SCOPES: 'read:user user:email',
  BACKEND_PUBLIC_URL: 'http://api.test',
  FRONTEND_URL: 'http://front.test',
});

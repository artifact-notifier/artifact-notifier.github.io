export interface OidcProfile {
  email: string;
  /** The provider asserts the user owns `email`: only then may it match an existing account. */
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
  provider: string;
  providerSubject: string;
}

export interface ProviderConfig {
  key: string;
  displayName: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

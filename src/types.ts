import type { Context } from "hono";

export interface Env {
  Bindings: {
    OAUTH_KV: KVNamespace;
    TANA_BEARER_TOKEN: string;
    AUTH_PASSWORD: string;
    JWT_SECRET: string;
    ORIGIN_URL: string;
    PUBLIC_URL: string;
  };
  Variables: {
    clientId?: string;
  };
}

export type AppContext = Context<Env>;

export interface ClientRegistration {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_uri?: string;
}

export interface AuthCodeData {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
}

export interface TokenRequest {
  grant_type: string;
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface JWTPayload {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
}

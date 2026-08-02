import { nanoid } from "nanoid";
import { base64url } from "rfc4648";

export interface PkceCodes {
  verifier: string;
  challenge: string;
  challengeMethod: "S256";
}

export async function codeVerifierToCodeChallenge(verifier: string) {
  if (verifier === undefined || verifier === "") {
    return "";
  }

  return base64url.stringify(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    ),
    { pad: false }
  );
}

export async function generatePkceCodes(): Promise<PkceCodes> {
  const verifier = nanoid(128);
  const challenge = await codeVerifierToCodeChallenge(verifier);
  return {
    verifier,
    challenge,
    challengeMethod: "S256",
  };
}

export function getOAuth2AuthorizationUrl(
  authority: string,
  clientID: string,
  redirectUri: string,
  scopes: string[],
  pkceCodes: PkceCodes
) {
  const authUrl = new URL(
    `${authority.replace(/\/+$/, "")}/oauth2/v2.0/authorize`
  );
  authUrl.search = new URLSearchParams({
    client_id: clientID,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
    code_challenge: pkceCodes.challenge,
    code_challenge_method: pkceCodes.challengeMethod,
  }).toString();
  return authUrl.toString();
}

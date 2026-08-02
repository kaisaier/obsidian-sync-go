import { expect } from "chai";
import {
  codeVerifierToCodeChallenge,
  generatePkceCodes,
  getOAuth2AuthorizationUrl,
} from "../src/oauth2Pkce";

describe("OAuth2 PKCE", () => {
  it("generates the RFC 7636 sample challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await codeVerifierToCodeChallenge(verifier);
    expect(challenge).to.equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds the microsoft authorization url with pkce parameters", () => {
    const authUrl = getOAuth2AuthorizationUrl(
      "https://login.microsoftonline.com/consumers/",
      "client-id",
      "obsidian://remotely-save-cb-onedrive",
      ["User.Read", "offline_access"],
      {
        verifier: "verifier",
        challenge: "challenge",
        challengeMethod: "S256",
      }
    );

    const parsed = new URL(authUrl);
    expect(parsed.origin + parsed.pathname).to.equal(
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
    );
    expect(parsed.searchParams.get("client_id")).to.equal("client-id");
    expect(parsed.searchParams.get("response_type")).to.equal("code");
    expect(parsed.searchParams.get("redirect_uri")).to.equal(
      "obsidian://remotely-save-cb-onedrive"
    );
    expect(parsed.searchParams.get("response_mode")).to.equal("query");
    expect(parsed.searchParams.get("scope")).to.equal(
      "User.Read offline_access"
    );
    expect(parsed.searchParams.get("code_challenge")).to.equal("challenge");
    expect(parsed.searchParams.get("code_challenge_method")).to.equal("S256");
  });

  it("generates a verifier and challenge pair", async () => {
    const pkce = await generatePkceCodes();
    expect(pkce.verifier.length).to.be.greaterThan(40);
    expect(pkce.challenge).to.match(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challengeMethod).to.equal("S256");
  });
});

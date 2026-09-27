import { nanoid } from "nanoid";
import {
  OAUTH2_FORCE_EXPIRE_MILLISECONDS,
  type RemotelySavePluginSettings,
  type SUPPORTED_SERVICES_TYPE,
} from "../../src/baseTypes";
import {
  COMMAND_CALLBACK_PRO,
  type FeatureInfo,
  PRO_CLIENT_ID,
  type PRO_FEATURE_TYPE,
  PRO_WEBSITE,
  type ProConfig,
} from "./baseTypesPro";
import { codeVerifier2CodeChallenge } from "./oauth2";

const site = PRO_WEBSITE;
console.debug(`remotelysave official website: ${site}`);
const LOCAL_PRO_EMAIL = "local-pro@obsidian-sync-go";
const LOCAL_PRO_TOKEN = "local-pro-token";
const LOCAL_PRO_EXPIRE_MS = 1000 * 60 * 60 * 24 * 365 * 10;

export const DEFAULT_PRO_CONFIG: ProConfig = {
  accessToken: "",
  accessTokenExpiresInMs: 0,
  accessTokenExpiresAtTimeMs: 0,
  refreshToken: "",
  enabledProFeatures: [],
  email: "",
};

const ALL_PRO_FEATURES: PRO_FEATURE_TYPE[] = [
  "feature-smart_conflict",
  "feature-onedrive_full",
  "feature-google_drive",
  "feature-box",
  "feature-pcloud",
  "feature-yandex_disk",
  "feature-koofr",
  "feature-azure_blob_storage",
];

const getLocalEnabledProFeatures = (): FeatureInfo[] => {
  const now = Date.now();
  const expireAtTimeMs = now + LOCAL_PRO_EXPIRE_MS;
  return ALL_PRO_FEATURES.map((featureName) => ({
    featureName,
    enableAtTimeMs: now as any,
    expireAtTimeMs: expireAtTimeMs as any,
  }));
};

const ensureLocalProConfigInplace = (config: ProConfig) => {
  const now = Date.now();
  config.accessToken = LOCAL_PRO_TOKEN;
  config.refreshToken = LOCAL_PRO_TOKEN;
  config.accessTokenExpiresInMs = LOCAL_PRO_EXPIRE_MS;
  config.accessTokenExpiresAtTimeMs = now + LOCAL_PRO_EXPIRE_MS;
  config.credentialsShouldBeDeletedAtTimeMs = now + LOCAL_PRO_EXPIRE_MS;
  config.email = LOCAL_PRO_EMAIL;
  config.enabledProFeatures = getLocalEnabledProFeatures();
};

export const generateAuthUrlAndCodeVerifierChallenge = async (
  hasCallback: boolean
) => {
  const codeVerifier = nanoid(128);
  const codeChallenge = await codeVerifier2CodeChallenge(codeVerifier);
  return {
    authUrl: "",
    codeVerifier,
    codeChallenge,
  };
};

export interface AuthResError {
  error: "invalid_request";
}

export interface AuthResSucc {
  error: undefined; // needed for typescript
  refresh_token?: string;
  access_token: string;
  expires_in: number;
}

export const sendAuthReq = async (
  verifier: string,
  authCode: string,
  errorCallBack: any
): Promise<AuthResError | AuthResSucc> => {
  try {
    return {
      error: undefined,
      access_token: LOCAL_PRO_TOKEN,
      refresh_token: LOCAL_PRO_TOKEN,
      expires_in: LOCAL_PRO_EXPIRE_MS / 1000,
    } as AuthResSucc;
  } catch (e) {
    console.error(e);
    if (errorCallBack !== undefined) {
      await errorCallBack(e);
    }
    return { error: "invalid_request" };
  }
};

export const sendRefreshTokenReq = async (refreshToken: string) => {
  try {
    return {
      error: undefined,
      access_token: LOCAL_PRO_TOKEN,
      refresh_token: LOCAL_PRO_TOKEN,
      expires_in: LOCAL_PRO_EXPIRE_MS / 1000,
    } as AuthResSucc;
  } catch (e) {
    console.error(e);
    throw e;
  }
};

export const setConfigBySuccessfullAuthInplace = async (
  config: ProConfig,
  authRes: AuthResError | AuthResSucc,
  saveUpdatedConfigFunc: () => Promise<any> | undefined
) => {
  ensureLocalProConfigInplace(config);
  await saveUpdatedConfigFunc?.();
};

export const getAccessToken = async (
  config: ProConfig,
  saveUpdatedConfigFunc: () => Promise<any> | undefined
) => {
  ensureLocalProConfigInplace(config);
  await saveUpdatedConfigFunc?.();
  return config.accessToken;
};

export const getAndSaveProFeatures = async (
  config: ProConfig,
  pluginVersion: string,
  saveUpdatedConfigFunc: () => Promise<any> | undefined
) => {
  ensureLocalProConfigInplace(config);
  await saveUpdatedConfigFunc?.();
  return {
    proFeatures: config.enabledProFeatures,
  };
};

export const getAndSaveProEmail = async (
  config: ProConfig,
  pluginVersion: string,
  saveUpdatedConfigFunc: () => Promise<any> | undefined
) => {
  ensureLocalProConfigInplace(config);
  await saveUpdatedConfigFunc?.();
  return {
    email: config.email ?? LOCAL_PRO_EMAIL,
  };
};

/**
 * If the check doesn't pass, the function should throw the error
 * @returns
 */
export const checkProRunnableAndFixInplace = async (
  config: RemotelySavePluginSettings,
  pluginVersion: string,
  saveUpdatedConfigFunc: () => Promise<any> | undefined
): Promise<true> => {
  console.debug(`checkProRunnableAndFixInplace`);
  if (config.pro === undefined) {
    config.pro = { ...DEFAULT_PRO_CONFIG };
  }
  ensureLocalProConfigInplace(config.pro);
  await saveUpdatedConfigFunc?.();
  return true;
};

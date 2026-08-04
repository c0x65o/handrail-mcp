export const CONNECTOR_NAME = "@handrail/mcp";
export const CONNECTOR_VERSION = "0.1.2";
export const API_CONTRACT_VERSION = "v1";
export const RELEASE_TAG = `v${CONNECTOR_VERSION}`;

export function versionMetadata() {
  return Object.freeze({
    connector_name: CONNECTOR_NAME,
    connector_version: CONNECTOR_VERSION,
    api_contract_version: API_CONTRACT_VERSION,
  });
}

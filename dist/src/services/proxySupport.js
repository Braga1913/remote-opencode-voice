import pc from 'picocolors';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
const LOOPBACK_NO_PROXY = ['localhost', '127.0.0.1', '::1'];
let initialized = false;
function getEnvValue(names) {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) {
            return value;
        }
    }
    return undefined;
}
function mergeNoProxy(existing) {
    const merged = new Set((existing ?? '')
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean));
    for (const value of LOOPBACK_NO_PROXY) {
        merged.add(value);
    }
    return Array.from(merged).join(',');
}
export function initializeProxySupport() {
    const allProxy = getEnvValue(['all_proxy', 'ALL_PROXY']);
    const httpProxy = getEnvValue(['http_proxy', 'HTTP_PROXY']) ?? allProxy;
    const httpsProxy = getEnvValue(['https_proxy', 'HTTPS_PROXY']) ?? httpProxy ?? allProxy;
    if (!httpProxy && !httpsProxy) {
        return false;
    }
    if (initialized) {
        return false;
    }
    const noProxy = mergeNoProxy(getEnvValue(['no_proxy', 'NO_PROXY']));
    const options = { noProxy };
    if (httpProxy) {
        options.httpProxy = httpProxy;
    }
    if (httpsProxy) {
        options.httpsProxy = httpsProxy;
    }
    setGlobalDispatcher(new EnvHttpProxyAgent(options));
    initialized = true;
    console.log(pc.dim('Proxy support enabled via environment.'));
    return true;
}
export function resetProxySupportForTests() {
    initialized = false;
}

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const defaultEnvPaths = [
    path.resolve(".env"),
    path.resolve("../Cloud-Admin/.env"),
    path.resolve("../CLIC-POS/.env"),
];

const loadEnv = (filePath) => Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
            const separator = line.indexOf("=");
            return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : null;
        })
        .filter(Boolean),
);

const loadRuntimeEnv = () => {
    for (const envPath of defaultEnvPaths) {
        if (fs.existsSync(envPath)) {
            return loadEnv(envPath);
        }
    }

    return process.env;
};

const parseArgs = () => {
    const args = process.argv.slice(2);
    const parsed = {};

    for (let i = 0; i < args.length; i += 1) {
        const current = args[i];
        if (!current.startsWith("--")) continue;

        const key = current.slice(2);
        const next = args[i + 1];
        parsed[key] = next && !next.startsWith("--") ? next : "true";
        if (parsed[key] === next) i += 1;
    }

    return parsed;
};

const env = loadRuntimeEnv();
const args = parseArgs();

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "landlord" },
});

const tenantId = args["tenant-id"] || null;
const tenantSlug = args["tenant-slug"] || null;
const tenantEmail = args["tenant-email"] || null;
const deviceId = args["device-id"] || "smoke-master-device";
const terminalId = args["terminal-id"] || "MASTER-01";
const terminalName = args["terminal-name"] || terminalId;
const hostname = args.hostname || "smoke-master";
const initialIp = args["local-ip"] || "192.168.10.20";
const rotatedIp = args["rotate-ip"] || null;
const port = Number(args.port || 3001);
const appVersion = args["app-version"] || "1.0.99";
const appVersionCode = Number(args["app-version-code"] || 999);

if (!tenantId && !tenantSlug && !tenantEmail) {
    throw new Error("Provide --tenant-id, --tenant-slug or --tenant-email.");
}

const registerPayload = (localIp) => ({
    p_tenant_id: tenantId,
    p_tenant_slug: tenantSlug,
    p_tenant_email: tenantEmail,
    p_device_id: deviceId,
    p_terminal_id: terminalId,
    p_terminal_name: terminalName,
    p_hostname: hostname,
    p_protocol: "http",
    p_port: port,
    p_local_ip: localIp,
    p_local_ips: [localIp],
    p_endpoint_url: `http://${localIp}:${port}`,
    p_is_primary: true,
    p_status: "ONLINE",
    p_app_version: appVersion,
    p_app_version_code: appVersionCode,
});

const resolvePayload = {
    p_tenant_id: tenantId,
    p_tenant_slug: tenantSlug,
    p_tenant_email: tenantEmail,
};

const runRpc = async (name, payload) => {
    const { data, error } = await client.rpc(name, payload);
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
};

const firstRegistration = await runRpc("register_tenant_server_endpoint", registerPayload(initialIp));
const firstResolution = await runRpc("resolve_tenant_server_endpoint", resolvePayload);

console.log("First registration:");
console.log(JSON.stringify(firstRegistration, null, 2));
console.log("\nFirst resolution:");
console.log(JSON.stringify(firstResolution, null, 2));

if (!firstResolution || firstResolution.local_ip !== initialIp) {
    throw new Error(`Expected resolved IP ${initialIp}, got ${firstResolution?.local_ip || "null"}`);
}

if (firstResolution?.app_version !== appVersion || Number(firstResolution?.app_version_code || 0) !== appVersionCode) {
    throw new Error(`Expected APK version ${appVersion} (${appVersionCode}), got ${firstResolution?.app_version || "null"} (${firstResolution?.app_version_code || "null"})`);
}

if (rotatedIp) {
    const rotatedRegistration = await runRpc("upsert_tenant_server_endpoint", registerPayload(rotatedIp));
    const rotatedResolution = await runRpc("get_tenant_server_endpoint", resolvePayload);

    console.log("\nRotated registration:");
    console.log(JSON.stringify(rotatedRegistration, null, 2));
    console.log("\nRotated resolution:");
    console.log(JSON.stringify(rotatedResolution, null, 2));

    if (!rotatedResolution || rotatedResolution.local_ip !== rotatedIp) {
        throw new Error(`Expected rotated IP ${rotatedIp}, got ${rotatedResolution?.local_ip || "null"}`);
    }

    if (rotatedResolution?.app_version !== appVersion || Number(rotatedResolution?.app_version_code || 0) !== appVersionCode) {
        throw new Error(`Expected rotated APK version ${appVersion} (${appVersionCode}), got ${rotatedResolution?.app_version || "null"} (${rotatedResolution?.app_version_code || "null"})`);
    }
}

console.log("\nMaster registry verification OK.");

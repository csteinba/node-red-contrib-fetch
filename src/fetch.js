module.exports = function (RED) {
    const http = require("http");
    const https = require("https");
    const fs = require("fs");

    function EndpointNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.config = {
            ...config,
        };
    }

    RED.nodes.registerType("fetch-endpoint", EndpointNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" },
            apiKeyValue: { type: "text" }
        },
    });

    function RequestNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name || `[${config.method}] ${config.url}`;

        // Get request endpoint
        const endpoint = RED.nodes.getNode(config.endpoint);

        // http / https agent config
        const agentConfig = {
            keepAlive: config.keepAlive,
            rejectUnauthorized: endpoint.config.rejectUnauthorized,
        };

        // Read ca certificate file
        if (endpoint.config.caCertPath) {
            try {
                agentConfig.ca = fs.readFileSync(endpoint.config.caCertPath);
            } catch (err) {
                node.error(new Error(`Failed to read CA certificate file: ${err.message}`));
            }
        }

        const httpsAgent = new https.Agent(agentConfig);
        const httpAgent = new http.Agent(agentConfig);

        // Base fetch config
        const timeoutMs = Number(config.timeout ?? "30000");
        let baseConfig = {
            method: (config.method || "GET").toUpperCase(),
            headers: {},
        };

        // Append basic auth header
        if (endpoint.credentials.username && endpoint.credentials.password) {
            const credentials = Buffer.from(
                `${endpoint.credentials.username}:${endpoint.credentials.password}`
            ).toString("base64");
            baseConfig.headers.Authorization = `Basic ${credentials}`;
        }

        // Node metrics
        const metric = {
            execCtr: 0,
            successCtr: 0,
            errorCtr: 0,
            runtime: 0,
        };

        function updateStatus({ fill }) {
            node.status({
                fill: fill,
                shape: "dot",
                text: `s=${metric.successCtr}, err=${metric.errorCtr}, rt=${metric.runtime}ms`,
            });
        }

        updateStatus({ fill: "green" });

        function fetchStart() {
            const fetchStartedAt = Date.now();
            metric.execCtr++;
            updateStatus({ fill: "blue" });
            return fetchStartedAt;
        }

        function fetchSuccess(fetchStartedAt) {
            metric.execCtr--;
            metric.successCtr++;
            metric.runtime = Date.now() - fetchStartedAt;
            updateStatus({
                fill: metric.execCtr > 0 ? "blue" : "green",
            });
        }

        function fetchFailed(fetchStartedAt) {
            metric.execCtr--;
            metric.errorCtr++;
            metric.runtime = Date.now() - fetchStartedAt;
            updateStatus({
                fill: "red",
            });
        }

        function getTypedInput({keyType, keyValue, msg}) {
            switch (keyType) {
                case "str":
                    return keyValue;
                case "msg":
                    return msg[keyValue];
                case "flow":
                    return node.context().flow.get(keyValue);
                case "global":
                    return node.context().global.get(keyValue);
            }
        }

        function getElements({list, msg}) {
            const obj = {};
            if (!Array.isArray(list)) return obj;
            list.forEach((el) => {
                obj[getTypedInput({keyType: el.keyType, keyValue: el.keyValue, msg})] =
                    getTypedInput({keyType: el.valueType, keyValue: el.valueValue, msg});
            });
            return obj;
        }

        node.on("input", async function (msg, send, done) {

            const fetchStartedAt = fetchStart();

            try {

                // Merge base URL path with request URL
                const urlObj = new URL(endpoint.config.baseURL);
                const relativeUrl = msg.url || config.url;

                urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/' + relativeUrl.replace(/^\//, '');
                delete msg.url;

                // Build query parameters
                let queryParams = {};
                if (baseConfig.method === "GET") {
                    queryParams = msg.params || msg.payload || {};
                } else {
                    queryParams = msg.params || {};
                }
                delete msg.params;

                queryParams = {
                    ...queryParams,
                    ...getElements({list: config.params, msg}),
                };

                // Handle API key
                if (endpoint.credentials.apiKeyValue && endpoint.config.apiKeyKey && endpoint.config.apiKeyAddTo) {
                    // Add API key to request
                    if (endpoint.config.apiKeyAddTo === "headers") {
                        baseConfig.headers[endpoint.config.apiKeyKey] = endpoint.credentials.apiKeyValue;
                    } else if (endpoint.config.apiKeyAddTo === "params") {
                        queryParams[endpoint.config.apiKeyKey] = endpoint.credentials.apiKeyValue;
                    }
                }

                // Append query parameters to URL
                Object.entries(queryParams).forEach(([key, value]) => {
                    urlObj.searchParams.append(key, value);
                });
                // Build fetch config
                const fetchConfig = {
                    ...baseConfig,
                    headers: {
                        ...msg.headers,
                        ...getElements({list: config.headers, msg}),
                        ...baseConfig.headers,
                    },
                    signal: AbortSignal.timeout(timeoutMs),
                };
                delete msg.headers;

                // Add body for non-GET requests
                if (baseConfig.method !== "GET" && msg.payload) {
                    if (typeof msg.payload === "string") {
                        fetchConfig.body = msg.payload;
                    } else {
                        fetchConfig.body = JSON.stringify(msg.payload);
                        fetchConfig.headers["Content-Type"] = fetchConfig.headers["Content-Type"] || "application/json";
                    }
                }

                // Determine which agent to use
                if (urlObj.protocol === "https:") {
                    fetchConfig.agent = httpsAgent;
                } else {
                    fetchConfig.agent = httpAgent;
                }

                // Make the request
                const response = await fetch(urlObj.toString(), fetchConfig);

                // Parse response based on responseType
                let responseBody;
                switch (config.resBodyType) {
                    case "text":
                        responseBody = await response.text();
                        break;

                    case "arraybuffer":
                        responseBody = await response.arrayBuffer();
                        break;

                    case "json":
                    default:
                        const responseText = await response.text();
                        try {
                            responseBody = JSON.parse(responseText);
                        } catch {
                            responseBody = responseText;
                        }

                }
                msg.payload = responseBody;

                // Include status code and headers in output if configured
                const sendResStatus = config.sendResStatus ?? true;
                if (sendResStatus === true) {
                    msg.statusCode = response.status;
                }

                const sendResHeaders = config.sendResHeaders ?? false;
                if (sendResHeaders === true) {
                    msg.headers = Object.fromEntries(response.headers.entries());
                }

                const statusFailed = response.status < 200 || response.status >= 300;
                if (statusFailed) {
                    const validateStatus = config.validateStatus ?? false;
                    if (validateStatus) {
                        let errMsg = `HTTP ${response.status}`;
                        if (responseBody !== undefined && responseBody !== null) {
                            if (typeof responseBody === "string") {
                                errMsg = responseBody;
                            } else if (responseBody instanceof ArrayBuffer) {
                                errMsg = `<${responseBody.byteLength} bytes>`;
                            } else {
                                errMsg = JSON.stringify(responseBody);
                            }
                        }
                        fetchFailed(fetchStartedAt);
                        done(new Error(errMsg));
                        return;
                    }
                    fetchFailed(fetchStartedAt);
                } else {
                    fetchSuccess(fetchStartedAt);
                }

                send(msg);
                done();
            } catch (err) {
                if (err.name === "AbortError") {
                    err.message = `Request timeout after ${config.timeout || 30000}ms`;
                }
                fetchFailed(fetchStartedAt);
                done(err);
            }
        });
    }

    RED.nodes.registerType("fetch-request", RequestNode);
};

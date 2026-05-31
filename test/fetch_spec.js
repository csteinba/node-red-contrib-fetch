const http = require("http");
const { URL } = require("url");
const should = require("should");
const helper = require("node-red-node-test-helper");
const fetchNode = require("../src/fetch.js");

const FETCH_MOCK_PORT = parseInt(process.env.FETCH_MOCK_PORT, 10) || 8800;
const FETCH_BASE_URL = process.env.FETCH_BASE_URL || `http://127.0.0.1:${FETCH_MOCK_PORT}`;

helper.init(require.resolve("node-red"));

function titleCaseHeader(name) {
    return name
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("-");
}

function echoHeaders(req) {
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
        headers[titleCaseHeader(name)] = value;
    }
    return headers;
}

function buildJsonResponse(statusCode, body) {
    const payload = JSON.stringify(body);
    return { statusCode, payload, headers: { "Content-Type": "application/json" } };
}

function mockServerHandler(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${FETCH_MOCK_PORT}`);
    const route = url.pathname;

    const sendJson = (body, code = 200) => {
        const payload = JSON.stringify(body);
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(payload);
    };

    if (route === "/get") {
        sendJson({ args: Object.fromEntries(url.searchParams.entries()), headers: echoHeaders(req) });
        return;
    }

    if (route === "/html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>Herman Melville - Moby-Dick</h1></body></html>");
        return;
    }

    if (route === "/headers") {
        sendJson({ headers: echoHeaders(req) });
        return;
    }

    if (route.startsWith("/basic-auth/")) {
        const [_, __, username, password] = route.split("/");
        const auth = req.headers.authorization || "";
        const expected = Buffer.from(`${username}:${password}`).toString("base64");
        if (auth === `Basic ${expected}`) {
            sendJson({ authenticated: true, user: username });
            return;
        }
        sendJson({ authenticated: false }, 401);
        return;
    }

    if (route === "/post") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", () => {
            let parsed = null;
            try {
                parsed = JSON.parse(body || "null");
            } catch (err) {
                parsed = body;
            }
            sendJson({ json: parsed, headers: echoHeaders(req) });
        });
        return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
}

let mockServer;

const defaultTestFlow = [
    {
        id: "fetch-endpoint-node",
        type: "fetch-endpoint",
        baseURL: FETCH_BASE_URL,
    },
    {
        id: "fetch-request-node",
        type: "fetch-request",
        wires: [["helper-node"]],
        endpoint: "fetch-endpoint-node",
        method: "get",
        url: "/get",
        resBodyType: "json",
        sendResStatus: true,
        sendResHeaders: false
    },
    { id: "helper-node", type: "helper" },
];

describe("fetch node tests", function () {
    before(function (done) {
        mockServer = http.createServer(mockServerHandler);
        mockServer.listen(FETCH_MOCK_PORT, done);
    });

    after(function (done) {
        if (!mockServer) {
            done();
            return;
        }
        mockServer.close(done);
    });

    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it("simple get request", function (done) {
        helper.load(fetchNode, defaultTestFlow, function () {
            const helperNode = helper.getNode("helper-node");
            const requestNode = helper.getNode("fetch-request-node");
            helperNode.on("input", (msg) => {
                try {
                    msg.should.have.property("statusCode", 200);
                    done();
                } catch (err) {
                    done(err);
                }
            });
            requestNode.receive({
                payload: {},
            });
        });
    });

    it("request with query param", function (done) {
        helper.load(fetchNode, defaultTestFlow, function () {
            const helperNode = helper.getNode("helper-node");
            const requestNode = helper.getNode("fetch-request-node");
            helperNode.on("input", (msg) => {
                try {
                    msg.should.have.property("statusCode", 200);
                    msg.should.have
                        .property("payload")
                        .with.property("args")
                        .with.property("foo", "bar");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            requestNode.receive({
                payload: {
                    foo: "bar",
                },
            });
        });
    });

    it("msg.url & msg.params & msg.headers", function (done) {
        helper.load(fetchNode, [
            {
                id: "fetch-endpoint-node",
                type: "fetch-endpoint",
                baseURL: FETCH_BASE_URL,
            },
            {
                id: "fetch-request-node",
                type: "fetch-request",
                wires: [["helper-node"]],
                endpoint: "fetch-endpoint-node",
                method: "get",
                url: "",
                resBodyType: "json"
            },
            { id: "helper-node", type: "helper" },
        ], function () {
            const helperNode = helper.getNode("helper-node");
            const requestNode = helper.getNode("fetch-request-node");
            helperNode.on("input", (msg) => {
                try {
                    msg.should.have.property("statusCode", 200);
                    msg.should.have
                        .property("payload")
                        .with.property("args")
                        .with.property("foo", "bar");
                    msg.should.have
                        .property("payload")
                        .with.property("headers")
                        .with.property("Foo", "bar");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            requestNode.receive({
                url: "/get",
                params: {
                    foo: "bar",
                },
                headers: {
                    foo: "bar"
                }
            });
        });
    });

    it("custom header", function (done) {
        helper.load(fetchNode, [
            {
                id: "fetch-endpoint-node",
                type: "fetch-endpoint",
                baseURL: FETCH_BASE_URL,
            },
            {
                id: "fetch-request-node",
                type: "fetch-request",
                wires: [["helper-node"]],
                endpoint: "fetch-endpoint-node",
                method: "get",
                url: "/get",
                headers: [{
                    keyType: "str",
                    keyValue: "foo",
                    valueType: "str",
                    valueValue: "bar"
                }]
            },
            { id: "helper-node", type: "helper" },
        ], function () {
            const helperNode = helper.getNode("helper-node");
            const requestNode = helper.getNode("fetch-request-node");
            helperNode.on("input", (msg) => {
                try {
                    msg.should.have
                        .property("payload")
                        .with.property("headers")
                        .with.property("Foo", "bar");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            requestNode.receive({
                payload: {}
            });
        });
    });

    it("post request", function (done) {
        helper.load(
            fetchNode,
            [
                {
                    id: "fetch-endpoint-node",
                    type: "fetch-endpoint",
                    baseURL: FETCH_BASE_URL,
                },
                {
                    id: "fetch-request-node",
                    type: "fetch-request",
                    wires: [["helper-node"]],
                    endpoint: "fetch-endpoint-node",
                    method: "post",
                    url: "/post",
                },
                { id: "helper-node", type: "helper" },
            ],
            function () {
                const helperNode = helper.getNode("helper-node");
                const requestNode = helper.getNode("fetch-request-node");
                helperNode.on("input", (msg) => {
                    try {
                        msg.should.have.property("statusCode", 200);
                        msg.should.have
                            .property("payload")
                            .with.property("json")
                            .with.property("foo", "bar");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                requestNode.receive({
                    payload: {
                        foo: "bar",
                    },
                });
            }
        );
    });

    it("basic authentication", function (done) {
        const credentials = {
            username: "my-super-user",
            password: "test-123",
        };
        helper.load(
            fetchNode,
            [
                {
                    id: "fetch-endpoint-node",
                    type: "fetch-endpoint",
                    baseURL: FETCH_BASE_URL,
                },
                {
                    id: "fetch-request-node",
                    type: "fetch-request",
                    wires: [["helper-node"]],
                    endpoint: "fetch-endpoint-node",
                    method: "get",
                    url: `/basic-auth/${credentials.username}/${credentials.password}`,
                },
                { id: "helper-node", type: "helper" },
            ],
            {
                "fetch-endpoint-node": credentials,
            },
            function () {
                const helperNode = helper.getNode("helper-node");
                const requestNode = helper.getNode("fetch-request-node");
                helperNode.on("input", (msg) => {
                    try {
                        msg.should.have.property("statusCode", 200);
                        msg.should.have
                            .property("payload")
                            .with.property("authenticated", true);
                        msg.should.have
                            .property("payload")
                            .with.property("user", credentials.username);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                requestNode.receive({
                    payload: {},
                });
            }
        );
    });

    it("add API key to headers", function (done) {
        const apiKey = {
            key: "Foo",
            value: "bar"
        };
        helper.load(
            fetchNode,
            [
                {
                    id: "fetch-endpoint-node",
                    type: "fetch-endpoint",
                    baseURL: FETCH_BASE_URL,
                    apiKeyKey: apiKey.key,
                    apiKeyAddTo: "headers"
                },
                {
                    id: "fetch-request-node",
                    type: "fetch-request",
                    wires: [["helper-node"]],
                    endpoint: "fetch-endpoint-node",
                    method: "get",
                    url: "/headers"
                },
                { id: "helper-node", type: "helper" },
            ],
            {
                "fetch-endpoint-node": {
                    apiKeyValue: apiKey.value,
                },
            },
            function () {
                const helperNode = helper.getNode("helper-node");
                const requestNode = helper.getNode("fetch-request-node");
                helperNode.on("input", (msg) => {
                    try {
                        msg.should.have.property("statusCode", 200);
                        msg.should.have.property("payload")
                            .with.property("headers")
                            .with.property(apiKey.key, apiKey.value);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                requestNode.receive({
                    payload: {},
                });
            }
        );
    });


    it("add API key to params", function (done) {
        const apiKey = {
            key: "Foo",
            value: "bar"
        };
        helper.load(
            fetchNode,
            [
                {
                    id: "fetch-endpoint-node",
                    type: "fetch-endpoint",
                    baseURL: FETCH_BASE_URL,
                    apiKeyKey: apiKey.key,
                    apiKeyAddTo: "params"
                },
                {
                    id: "fetch-request-node",
                    type: "fetch-request",
                    wires: [["helper-node"]],
                    endpoint: "fetch-endpoint-node",
                    method: "get",
                    url: "/get",
                    verboseOut: true,
                    validateStatus: false,
                },
                { id: "helper-node", type: "helper" },
            ],
            {
                "fetch-endpoint-node": {
                    apiKeyValue: apiKey.value,
                },
            },
            function () {
                const helperNode = helper.getNode("helper-node");
                const requestNode = helper.getNode("fetch-request-node");
                helperNode.on("input", (msg) => {
                    try {
                        msg.should.have.property("statusCode", 200);
                        msg.should.have.property("payload")
                            .with.property("args")
                            .with.property(apiKey.key, apiKey.value);
                            done();
                    } catch (err) {
                        done(err);
                    }
                });
                requestNode.receive({
                    payload: {},
                });
            }
        );
    });
});

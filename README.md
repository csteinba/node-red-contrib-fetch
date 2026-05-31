# node-red-contrib-fetch

A simple Node-RED node for fetching data from HTTP endpoints using the `fetch` API.

## Install

```bash
npm install node-red-contrib-fetch
```

## Features

- GET, POST, PUT, DELETE and other HTTP methods
- Custom request headers
- JSON and text payload handling
- Outputs the response body as `msg.payload`

## Usage

- **Endpoint node**: configure a `fetch-endpoint` with `baseURL`, optional Basic Auth (`username`/`password`), API key (`apiKeyKey`/`apiKeyValue`), and TLS options (`caCertPath`, `rejectUnauthorized`). The endpoint's `baseURL` is prepended to request `url` values.

- **Request node**: the `fetch-request` node selects an Endpoint and makes HTTP requests. Key properties:
- **Method**: HTTP verb (GET, POST, PUT, PATCH, DELETE, ...).
- **URL**: path appended to the endpoint `baseURL` (or set `msg.url` to override at runtime).
- **Params / Headers**: editable lists with typed inputs (`str`, `msg`, `flow`, `global`) for keys and values.
- **Return type**: `json`, `text`, or `arraybuffer` — parsed into `msg.payload`.
- **Return headers/status**: enable to put response headers into `msg.headers` and status code into `msg.statusCode`.
- **Validate status**: treat non-2xx responses as errors when enabled.
- **Keep-Alive / Timeout**: reuse connections and set request timeout (ms).

## Message properties

- `msg.payload` — request body (for POST/PUT/PATCH/DELETE) and parsed response body on output.
- `msg.headers` — custom request headers (can also be provided via node config).
- `msg.params` — request query parameters (can also be provided via node config).
- `msg.url` — when set, overrides the node's configured `URL` for that message.

## Node status

- Status tags: `s` = successful requests (2xx), `err` = failed requests, `rt` = last response runtime (ms).
- Colors: green = success, blue = in progress, red = failed.

For details and examples see the node edit dialogs in the Node-RED editor.

## License

MIT
import { describe, expect, jest, test, beforeEach } from "@jest/globals";

let server;
const createServerMock = jest.fn(() => server);

jest.unstable_mockModule("node:http", () => ({
  default: { createServer: createServerMock },
  createServer: createServerMock,
}));

const { createHttpServer } = await import("../../src/be/http-server.mjs");

beforeEach(() => {
  server = { listen: jest.fn(() => server) };
  createServerMock.mockClear();
});

describe("createHttpServer", () => {
  test("creates a server and listens on the requested host and port", () => {
    const returnedServer = createHttpServer({
      host: "127.0.0.1",
      port: 4321,
      publicDir: "/tmp/public",
    });

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(createServerMock).toHaveBeenCalledWith(expect.any(Function));
    expect(server.listen).toHaveBeenCalledWith(4321, "127.0.0.1");
    expect(returnedServer).toBe(server);
  });
});

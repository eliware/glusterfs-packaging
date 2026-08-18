import { describe, expect, jest, test, beforeEach } from "@jest/globals";

const createHttpServerMock = jest.fn();

jest.unstable_mockModule("../../src/be/http-server.mjs", () => ({
  createHttpServer: createHttpServerMock,
}));

const { startApp } = await import("../../src/be/app.mjs");

beforeEach(() => {
  createHttpServerMock.mockReset();
  createHttpServerMock.mockReturnValue({ mocked: true });
  delete process.env.HOST;
  delete process.env.PORT;
});

describe("startApp", () => {
  test("starts with the default host, port, and public directory", () => {
    const server = startApp();

    expect(server).toEqual({ mocked: true });
    expect(createHttpServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "0.0.0.0",
        port: 8000,
        publicDir: expect.any(String),
      }),
    );
  });

  test("uses environment defaults when provided", () => {
    process.env.HOST = "127.0.0.1";
    process.env.PORT = "9001";

    const server = startApp();

    expect(server).toEqual({ mocked: true });
    expect(createHttpServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 9001,
        publicDir: expect.any(String),
      }),
    );
  });

  test("passes through custom settings", () => {
    const server = startApp({
      host: "127.0.0.1",
      port: 1234,
      publicDir: "/tmp/public",
    });

    expect(server).toEqual({ mocked: true });
    expect(createHttpServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 1234,
        publicDir: "/tmp/public",
      }),
    );
  });
});

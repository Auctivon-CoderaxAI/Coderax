export function mongoPort() {
  const value = process.env.CODERAX_MONGO_PORT ?? '27017';
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid CODERAX_MONGO_PORT: ${value}`);
  }
  return port;
}

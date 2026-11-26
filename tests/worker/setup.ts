import { createServer } from 'vite';

export async function startWorker() {
  const url = process.env.MAHJONG_TEST_URL;
  if (url) return { url: new URL(url).origin };

  const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, clearScreen: false });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Void did not open a local port');
    return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

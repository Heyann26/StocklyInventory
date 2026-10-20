export default function handler(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      app: 'Stockly',
      node: process.version
    });
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: e.message }));
  }
}

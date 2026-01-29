import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const nodeAddress = process.env.NODE_ADDRESS || process.env.VITE_NODE_ADDRESS;
    if (!nodeAddress) {
        res.status(500).json({ error: 'NODE_ADDRESS is not configured' });
        return;
    }

    const rpcUrl = nodeAddress.endsWith('/rpc') ? nodeAddress : `${nodeAddress}/rpc`;

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const upstream = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
}

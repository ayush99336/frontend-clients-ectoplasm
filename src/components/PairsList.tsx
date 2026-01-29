import React, { useState, useEffect } from 'react';
import { useDex } from '../contexts/DexContext';

export const PairsList: React.FC = () => {
    const { dex } = useDex();
    const [pairs, setPairs] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPairs = async () => {
            setLoading(true);
            try {
                const allPairs = await dex.getAllPairs();
                setPairs(allPairs);
            } catch (e) {
                console.error('Error fetching pairs:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchPairs();
    }, [dex]);

    if (loading) {
        return (
            <div className="card">
                <h3>Liquidity Pools</h3>
                <p>Loading...</p>
            </div>
        );
    }

    return (
        <div className="card">
            <h3>Liquidity Pools ({pairs.length})</h3>
            {pairs.length === 0 ? (
                <div style={{ padding: '1rem', color: '#aaa', textAlign: 'center' }}>
                    <p>⚠️ No liquidity pools exist yet</p>
                    <p style={{ fontSize: '0.9rem' }}>
                        Create a pool by adding liquidity for a token pair
                    </p>
                </div>
            ) : (
                <div style={{ marginTop: '1rem' }}>
                    {pairs.map((pair, index) => (
                        <div 
                            key={pair}
                            style={{
                                padding: '0.75rem',
                                marginBottom: '0.5rem',
                                background: 'rgba(255,255,255,0.05)',
                                borderRadius: '4px',
                                fontSize: '0.85rem'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                                Pool #{index + 1}
                            </div>
                            <div style={{ color: '#aaa', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                {pair}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

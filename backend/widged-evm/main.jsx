import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { http, createConfig, WagmiProvider } from 'wagmi';
import { mainnet, sepolia, polygon, arbitrum, base } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { useAccount, useConnect, useDisconnect } from 'wagmi';


const config = createConfig({
chains: [mainnet, base, arbitrum, polygon, sepolia],
connectors: [injected()],
transports: {
[mainnet.id]: http(),
[base.id]: http(),
[arbitrum.id]: http(),
[polygon.id]: http(),
[sepolia.id]: http()
}
});


function App(){
const { connect, connectors, status, error } = useConnect();
const { address, isConnected } = useAccount();
const { disconnect } = useDisconnect();


useEffect(() => {
if (isConnected && address) {
window.parent?.postMessage({ type: 'evm-connected', payload: { address } }, '*');
}
}, [isConnected, address]);


return (
<div style={{ fontFamily:'sans-serif', padding:16 }}>
<h3>EVM Wallet</h3>
{isConnected ? (
<>
<div>Connected: <code>{address}</code></div>
<button onClick={() => disconnect()}>Disconnect</button>
</>
) : (
<>
{connectors.map((c) => (
<button key={c.uid} onClick={() => connect({ connector: c })} disabled={!c.ready} style={{ marginRight:8 }}>
{c.name}{!c.ready ? ' (not ready)' : ''}
</button>
))}
<div style={{ marginTop:8 }}>
Status: {status} {error ? <span style={{ color:'red' }}>{String(error?.message||error)}</span> : null}
</div>
</>
)}
</div>
);
}


createRoot(document.getElementById('root')).render(
<WagmiProvider config={config}>
<App />
</WagmiProvider>
);

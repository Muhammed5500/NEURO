"use client";

import { TrendingUp, TrendingDown, Sparkles } from "lucide-react";

interface TokenRow {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
}

// Mock data
const trendingTokens: TokenRow[] = [
  { rank: 1, symbol: "PEPE", name: "Pepe", price: 0.00001234, change24h: 15.5, volume24h: 125000, marketCap: 500000 },
  { rank: 2, symbol: "DOGE", name: "Doge", price: 0.00005678, change24h: -5.2, volume24h: 89000, marketCap: 350000 },
  { rank: 3, symbol: "SHIB", name: "Shiba", price: 0.00000123, change24h: 8.3, volume24h: 67000, marketCap: 280000 },
  { rank: 4, symbol: "FLOKI", name: "Floki", price: 0.00003456, change24h: -2.1, volume24h: 45000, marketCap: 220000 },
  { rank: 5, symbol: "WOJAK", name: "Wojak", price: 0.00002345, change24h: 25.8, volume24h: 34000, marketCap: 180000 },
];

export function MarketOverview() {
  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyber-cyan" />
          Trending on nad.fun
        </h2>
        <button className="text-sm text-cyber-purple hover:text-cyber-pink transition-colors">
          View All →
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-cyber-purple/20">
              <th className="pb-3 font-medium">#</th>
              <th className="pb-3 font-medium">Token</th>
              <th className="pb-3 font-medium text-right">Price</th>
              <th className="pb-3 font-medium text-right">24h %</th>
              <th className="pb-3 font-medium text-right">Volume (24h)</th>
              <th className="pb-3 font-medium text-right">Market Cap</th>
              <th className="pb-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {trendingTokens.map((token) => (
              <tr
                key={token.symbol}
                className="border-b border-cyber-purple/10 hover:bg-cyber-gray/30 transition-colors"
              >
                <td className="py-4 text-gray-500">{token.rank}</td>
                <td className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyber-purple to-cyber-pink flex items-center justify-center text-xs font-bold">
                      {token.symbol[0]}
                    </div>
                    <div>
                      <p className="font-medium text-white">{token.symbol}</p>
                      <p className="text-xs text-gray-500">{token.name}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 text-right font-mono text-white">
                  ${token.price.toFixed(8)}
                </td>
                <td className="py-4 text-right">
                  <div
                    className={`inline-flex items-center gap-1 ${
                      token.change24h >= 0 ? "text-cyber-green" : "text-cyber-red"
                    }`}
                  >
                    {token.change24h >= 0 ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    {Math.abs(token.change24h).toFixed(1)}%
                  </div>
                </td>
                <td className="py-4 text-right font-mono text-gray-400">
                  ${(token.volume24h / 1000).toFixed(1)}K
                </td>
                <td className="py-4 text-right font-mono text-gray-400">
                  ${(token.marketCap / 1000).toFixed(1)}K
                </td>
                <td className="py-4 text-right">
                  <button className="px-3 py-1 text-xs font-medium text-cyber-purple border border-cyber-purple/50 rounded hover:bg-cyber-purple/20 transition-colors">
                    Analyze
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

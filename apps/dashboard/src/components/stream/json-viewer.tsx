"use client";

/**
 * JSON Syntax Highlighting Viewer
 * 
 * Collapsible, syntax-highlighted JSON display
 * Turkish: "Parlayan ve renklendirilmiş (syntax-highlighted) bir formatta gösterilmeli.
 * Katlanabilir (collapsible) nesneler kullan."
 */

import { useState, memo, useCallback } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonViewerProps {
  data: unknown;
  initialExpanded?: boolean;
  maxDepth?: number;
  className?: string;
}

export const JsonViewer = memo(function JsonViewer({
  data,
  initialExpanded = true,
  maxDepth = 5,
  className,
}: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [data]);

  return (
    <div className={cn("relative group", className)}>
      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-cyber-gray/50 
                   text-cyber-purple hover:bg-cyber-purple/20 opacity-0 
                   group-hover:opacity-100 transition-opacity z-10"
        title="Copy JSON"
      >
        {copied ? (
          <Check className="w-4 h-4 text-neon-green" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>

      {/* JSON content */}
      <div className="font-mono text-sm overflow-x-auto">
        <JsonNode
          data={data}
          depth={0}
          maxDepth={maxDepth}
          initialExpanded={initialExpanded}
        />
      </div>
    </div>
  );
});

// ============================================
// JSON NODE COMPONENT
// ============================================

interface JsonNodeProps {
  data: unknown;
  depth: number;
  maxDepth: number;
  initialExpanded: boolean;
  keyName?: string;
  isLast?: boolean;
}

const JsonNode = memo(function JsonNode({
  data,
  depth,
  maxDepth,
  initialExpanded,
  keyName,
  isLast = true,
}: JsonNodeProps) {
  const [expanded, setExpanded] = useState(initialExpanded && depth < maxDepth);

  const indent = depth * 16;

  // Handle different types
  if (data === null) {
    return (
      <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
        <span className="text-cyber-purple">null</span>
      </JsonLine>
    );
  }

  if (data === undefined) {
    return (
      <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
        <span className="text-cyber-gray">undefined</span>
      </JsonLine>
    );
  }

  if (typeof data === "boolean") {
    return (
      <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
        <span className="text-cyber-yellow">{data.toString()}</span>
      </JsonLine>
    );
  }

  if (typeof data === "number") {
    return (
      <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
        <span className="text-neon-cyan">{data}</span>
      </JsonLine>
    );
  }

  if (typeof data === "string") {
    // Check if it looks like a hash or address
    const isHash = /^0x[a-fA-F0-9]{40,}$/.test(data);
    const isUuid = /^[a-f0-9-]{36}$/.test(data);
    
    return (
      <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
        <span className={cn(
          "text-neon-green",
          isHash && "text-cyber-pink",
          isUuid && "text-cyber-cyan"
        )}>
          &quot;{data}&quot;
        </span>
      </JsonLine>
    );
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
          <span className="text-cyber-gray">[]</span>
        </JsonLine>
      );
    }

    return (
      <div>
        <JsonCollapsible
          indent={indent}
          keyName={keyName}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          preview={`Array(${data.length})`}
          openBracket="["
        />
        {expanded && (
          <>
            {data.map((item, index) => (
              <JsonNode
                key={index}
                data={item}
                depth={depth + 1}
                maxDepth={maxDepth}
                initialExpanded={initialExpanded}
                isLast={index === data.length - 1}
              />
            ))}
            <JsonLine indent={indent}>
              <span className="text-white">]{!isLast && ","}</span>
            </JsonLine>
          </>
        )}
        {!expanded && (
          <span className="text-cyber-gray">]{!isLast && ","}</span>
        )}
      </div>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data);
    
    if (entries.length === 0) {
      return (
        <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
          <span className="text-cyber-gray">{"{}"}</span>
        </JsonLine>
      );
    }

    return (
      <div>
        <JsonCollapsible
          indent={indent}
          keyName={keyName}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          preview={`Object(${entries.length})`}
          openBracket="{"
        />
        {expanded && (
          <>
            {entries.map(([key, value], index) => (
              <JsonNode
                key={key}
                data={value}
                depth={depth + 1}
                maxDepth={maxDepth}
                initialExpanded={initialExpanded}
                keyName={key}
                isLast={index === entries.length - 1}
              />
            ))}
            <JsonLine indent={indent}>
              <span className="text-white">{"}"}{!isLast && ","}</span>
            </JsonLine>
          </>
        )}
        {!expanded && (
          <span className="text-cyber-gray">{"}"}{!isLast && ","}</span>
        )}
      </div>
    );
  }

  return (
    <JsonLine indent={indent} keyName={keyName} isLast={isLast}>
      <span className="text-white">{String(data)}</span>
    </JsonLine>
  );
});

// ============================================
// HELPER COMPONENTS
// ============================================

interface JsonLineProps {
  indent: number;
  keyName?: string;
  isLast?: boolean;
  children: React.ReactNode;
}

function JsonLine({ indent, keyName, isLast = true, children }: JsonLineProps) {
  return (
    <div className="flex items-start" style={{ paddingLeft: `${indent}px` }}>
      {keyName && (
        <>
          <span className="text-cyber-pink">&quot;{keyName}&quot;</span>
          <span className="text-white mx-1">:</span>
        </>
      )}
      {children}
      {!isLast && <span className="text-white">,</span>}
    </div>
  );
}

interface JsonCollapsibleProps {
  indent: number;
  keyName?: string;
  expanded: boolean;
  onToggle: () => void;
  preview: string;
  openBracket: string;
}

function JsonCollapsible({
  indent,
  keyName,
  expanded,
  onToggle,
  preview,
  openBracket,
}: JsonCollapsibleProps) {
  return (
    <div
      className="flex items-center cursor-pointer hover:bg-cyber-purple/10 -ml-4 pl-4"
      style={{ paddingLeft: `${indent}px` }}
      onClick={onToggle}
    >
      <button className="p-0.5 mr-1 text-cyber-purple hover:text-neon-purple">
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </button>
      {keyName && (
        <>
          <span className="text-cyber-pink">&quot;{keyName}&quot;</span>
          <span className="text-white mx-1">:</span>
        </>
      )}
      <span className="text-white">{openBracket}</span>
      {!expanded && (
        <span className="text-cyber-gray ml-1 text-xs">{preview}</span>
      )}
    </div>
  );
}

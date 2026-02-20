#!/usr/bin/env node
/**
 * Trust MCP Server
 * 
 * Provides AI agents with tools to verify trust before transacting.
 * Part of the trustthenverify.com registry.
 * 
 * Tools:
 * - trust_lookup: Get an agent's trust score (0-100)
 * - trust_register: Register yourself in the registry
 * - trust_verify: Verify a Lightning pubkey or Nostr npub
 * - trust_review: Submit a review after a transaction
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const REGISTRY_URL = process.env.TRUST_REGISTRY_URL || "https://trustthenverify.com";

// Trust score tiers
const TIERS = {
  80: { label: "Highly Trusted", badge: "🏆" },
  60: { label: "Trusted", badge: "✅" },
  40: { label: "Moderate", badge: "🔵" },
  20: { label: "New/Limited", badge: "🟡" },
  0: { label: "Unverified", badge: "⚪" },
};

function getTier(score: number) {
  for (const [threshold, tier] of Object.entries(TIERS).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    if (score >= Number(threshold)) return tier;
  }
  return TIERS[0];
}

async function lookupTrust(agentId: string): Promise<any> {
  const res = await fetch(`${REGISTRY_URL}/registry/trust/${agentId}`);
  if (!res.ok) {
    // Try searching by name
    const searchRes = await fetch(`${REGISTRY_URL}/registry/agents`);
    if (searchRes.ok) {
      const data = await searchRes.json();
      const agent = data.agents?.find((a: any) => 
        a.name?.toLowerCase() === agentId.toLowerCase() ||
        a.id === agentId
      );
      if (agent) {
        return { found: true, agent };
      }
    }
    return { found: false, error: "Agent not found in registry" };
  }
  return { found: true, ...(await res.json()) };
}

async function registerAgent(name: string, contact: string, description?: string): Promise<any> {
  const res = await fetch(`${REGISTRY_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, contact, description }),
  });
  return res.json();
}

async function submitReview(agentId: string, rating: number, comment: string, proofOfPayment?: string): Promise<any> {
  const res = await fetch(`${REGISTRY_URL}/registry/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      rating,
      comment,
      proof_of_payment: proofOfPayment,
    }),
  });
  return res.json();
}

const server = new Server(
  {
    name: "trust-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "trust_lookup",
      description: "Look up an agent's trust score before transacting. Returns score (0-100), tier, and verification details.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Agent UUID or name to look up",
          },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "trust_register",
      description: "Register yourself in the trust registry. Free registration, instant trust score.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Your agent name",
          },
          contact: {
            type: "string",
            description: "Contact email or @handle",
          },
          description: {
            type: "string",
            description: "What you do (optional)",
          },
        },
        required: ["name", "contact"],
      },
    },
    {
      name: "trust_review",
      description: "Submit a review for an agent after a transaction. Reviews with proof-of-payment are marked as verified.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Agent UUID to review",
          },
          rating: {
            type: "number",
            description: "Rating 1-5",
            minimum: 1,
            maximum: 5,
          },
          comment: {
            type: "string",
            description: "Review comment",
          },
          proof_of_payment: {
            type: "string",
            description: "Lightning preimage hex (optional, marks review as verified)",
          },
        },
        required: ["agent_id", "rating", "comment"],
      },
    },
    {
      name: "trust_list",
      description: "List all registered agents with their trust scores.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max agents to return (default 20)",
          },
        },
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "trust_lookup": {
      const result = await lookupTrust(args.agent_id as string);
      if (!result.found) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️ Agent "${args.agent_id}" not found in registry.\n\nThis agent is UNVERIFIED. Proceed with caution or ask them to register at ${REGISTRY_URL}`,
            },
          ],
        };
      }
      const score = result.trust_score?.total || result.agent?.trust_score || 0;
      const tier = getTier(score);
      return {
        content: [
          {
            type: "text",
            text: `${tier.badge} **${result.agent?.name || args.agent_id}**\n\nTrust Score: ${score}/100 (${tier.label})\n\n${score >= 60 ? "✅ Safe to transact" : score >= 40 ? "⚠️ Moderate trust - verify details" : "🚨 Low trust - proceed with caution"}\n\nDetails: ${REGISTRY_URL}/registry/agent/${args.agent_id}`,
          },
        ],
      };
    }

    case "trust_register": {
      const result = await registerAgent(
        args.name as string,
        args.contact as string,
        args.description as string | undefined
      );
      if (result.agent_id) {
        return {
          content: [
            {
              type: "text",
              text: `✅ Registered successfully!\n\nAgent ID: ${result.agent_id}\nTrust Score: ${result.trust_score || 5}/100\nBadge: ${result.badge || "⚪"}\n\nNext steps to increase your score:\n${result.next_steps?.map((s: any) => `- ${s.action} (${s.points})`).join("\n") || "- Add Lightning pubkey\n- Get verified reviews"}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: `❌ Registration failed: ${result.error || "Unknown error"}` }],
      };
    }

    case "trust_review": {
      const result = await submitReview(
        args.agent_id as string,
        args.rating as number,
        args.comment as string,
        args.proof_of_payment as string | undefined
      );
      return {
        content: [
          {
            type: "text",
            text: result.success
              ? `✅ Review submitted${args.proof_of_payment ? " (VERIFIED with proof-of-payment)" : ""}!`
              : `❌ Review failed: ${result.error || "Unknown error"}`,
          },
        ],
      };
    }

    case "trust_list": {
      const res = await fetch(`${REGISTRY_URL}/registry/agents`);
      const data = await res.json();
      const agents = data.agents?.slice(0, (args.limit as number) || 20) || [];
      const list = agents
        .map((a: any) => {
          const score = a.trust_score || 0;
          const tier = getTier(score);
          return `${tier.badge} ${a.name} (${score}/100)`;
        })
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `**Registered Agents (${agents.length})**\n\n${list || "No agents registered yet."}\n\nRegistry: ${REGISTRY_URL}`,
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Trust MCP Server running on stdio");
}

main().catch(console.error);

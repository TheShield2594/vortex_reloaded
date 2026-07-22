import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

// OpenAPI 3.1 spec for VortexChat REST API.
// Mounted at GET /api/docs — requires a valid authenticated session.
// Update this object as new routes are added; see CONTRIBUTING.md for guidance.
const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "VortexChat API",
    version: "1.0.0",
    description:
      "Internal REST API for the VortexChat platform. All endpoints require a valid Supabase session cookie unless noted otherwise.",
    contact: { url: "https://github.com/TheShield2594/vortexchat" },
  },
  servers: [{ url: "/api", description: "Current deployment" }],
  components: {
    securitySchemes: {
      supabaseSession: {
        type: "apiKey",
        in: "cookie",
        name: "sb-access-token",
        description: "Supabase session cookie set by the auth flow",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
      Server: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          icon_url: { type: "string", nullable: true },
          owner_id: { type: "string", format: "uuid" },
          verification_level: { type: "integer", minimum: 0, maximum: 4 },
          screening_enabled: { type: "boolean" },
        },
      },
      Channel: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          server_id: { type: "string", format: "uuid" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["text", "voice", "category", "forum", "stage", "announcement", "media"],
          },
          position: { type: "integer" },
          topic: { type: "string", nullable: true },
          last_post_at: { type: "string", format: "date-time", nullable: true },
        },
      },
      Message: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          channel_id: { type: "string", format: "uuid" },
          author_id: { type: "string", format: "uuid" },
          content: { type: "string" },
          thread_id: { type: "string", format: "uuid", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time", nullable: true },
        },
      },
      Thread: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          parent_channel_id: { type: "string", format: "uuid" },
          name: { type: "string" },
          archived: { type: "boolean" },
          locked: { type: "boolean" },
          message_count: { type: "integer" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Member: {
        type: "object",
        properties: {
          server_id: { type: "string", format: "uuid" },
          user_id: { type: "string", format: "uuid" },
          nickname: { type: "string", nullable: true },
          timeout_until: { type: "string", format: "date-time", nullable: true },
        },
      },
      Role: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          server_id: { type: "string", format: "uuid" },
          name: { type: "string" },
          permissions: { type: "integer", description: "Bitmask of PERMISSIONS constants" },
          color: { type: "string", nullable: true },
          position: { type: "integer" },
          is_default: { type: "boolean" },
        },
      },
      DirectMessageChannel: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          is_group: { type: "boolean" },
          name: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      AutomodRule: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          server_id: { type: "string", format: "uuid" },
          name: { type: "string" },
          trigger_type: {
            type: "string",
            enum: ["keyword_filter", "mention_spam", "link_spam"],
          },
          config: { type: "object" },
          actions: { type: "array", items: { type: "object" } },
          enabled: { type: "boolean" },
        },
      },
    },
  },
  security: [{ supabaseSession: [] }],
  paths: {
    // ── Servers ──────────────────────────────────────────────────────────────
    "/servers/discover": {
      get: {
        summary: "Discover public servers",
        tags: ["Servers"],
        security: [],
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Search term matched against name and description" },
          { name: "sort", in: "query", schema: { type: "string", enum: ["members", "newest"], default: "members" }, description: "Sort order" },
          { name: "cursor", in: "query", schema: { type: "string", format: "uuid" }, description: "ID of the last item from the previous page" },
        ],
        responses: {
          "200": {
            description: "Paginated list of public servers",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["servers", "nextCursor"],
                  properties: {
                    servers: { type: "array", items: { $ref: "#/components/schemas/Server" } },
                    nextCursor: { type: "string", format: "uuid", nullable: true, description: "Cursor for the next page, null when no more results" },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/servers/{serverId}": {
      get: {
        summary: "Get server details",
        tags: ["Servers"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Server object", content: { "application/json": { schema: { $ref: "#/components/schemas/Server" } } } },
          "403": { description: "Not a member", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "404": { description: "Server not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      patch: {
        summary: "Update server settings",
        tags: ["Servers"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  icon_url: { type: "string" },
                  verification_level: { type: "integer", minimum: 0, maximum: 4 },
                  screening_enabled: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated server", content: { "application/json": { schema: { $ref: "#/components/schemas/Server" } } } },
          "403": { description: "Missing MANAGE_SERVER permission" },
        },
      },
      delete: {
        summary: "Delete a server (owner only)",
        tags: ["Servers"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Server deleted" },
          "403": { description: "Not the server owner" },
        },
      },
    },
    "/servers/{serverId}/channels": {
      get: {
        summary: "List channels in a server",
        tags: ["Channels"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Ordered channel list",
            content: {
              "application/json": {
                schema: { type: "object", properties: { channels: { type: "array", items: { $ref: "#/components/schemas/Channel" } } } },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a channel",
        tags: ["Channels"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "type"],
                properties: {
                  name: { type: "string" },
                  type: { $ref: "#/components/schemas/Channel/properties/type" },
                  parent_id: { type: "string", format: "uuid", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Created channel", content: { "application/json": { schema: { $ref: "#/components/schemas/Channel" } } } },
          "403": { description: "Missing MANAGE_CHANNELS permission" },
        },
      },
    },
    "/servers/{serverId}/members": {
      get: {
        summary: "List server members",
        tags: ["Members"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Member list",
            content: {
              "application/json": {
                schema: { type: "object", properties: { members: { type: "array", items: { $ref: "#/components/schemas/Member" } } } },
              },
            },
          },
        },
      },
    },
    "/servers/{serverId}/members/{userId}/timeout": {
      put: {
        summary: "Apply or remove a member timeout",
        tags: ["Moderation"],
        parameters: [
          { name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  timeout_until: { type: "string", format: "date-time", nullable: true, description: "null to remove timeout" },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Timeout applied" },
          "403": { description: "Missing MODERATE_MEMBERS permission" },
        },
      },
    },
    "/servers/{serverId}/roles": {
      get: {
        summary: "List server roles",
        tags: ["Roles"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Role list",
            content: {
              "application/json": {
                schema: { type: "object", properties: { roles: { type: "array", items: { $ref: "#/components/schemas/Role" } } } },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a role",
        tags: ["Roles"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  permissions: { type: "integer" },
                  color: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Created role", content: { "application/json": { schema: { $ref: "#/components/schemas/Role" } } } },
          "403": { description: "Missing MANAGE_ROLES permission" },
        },
      },
    },
    "/servers/{serverId}/automod": {
      get: {
        summary: "List AutoMod rules",
        tags: ["Moderation"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "AutoMod rules",
            content: {
              "application/json": {
                schema: { type: "object", properties: { rules: { type: "array", items: { $ref: "#/components/schemas/AutomodRule" } } } },
              },
            },
          },
        },
      },
      post: {
        summary: "Create an AutoMod rule",
        tags: ["Moderation"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/AutomodRule" } },
          },
        },
        responses: {
          "200": { description: "Created rule", content: { "application/json": { schema: { $ref: "#/components/schemas/AutomodRule" } } } },
          "403": { description: "Missing MANAGE_SERVER permission" },
        },
      },
    },
    "/servers/{serverId}/bans": {
      get: {
        summary: "List server bans",
        tags: ["Moderation"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Ban list" },
          "403": { description: "Missing BAN_MEMBERS permission" },
        },
      },
      post: {
        summary: "Ban a user",
        tags: ["Moderation"],
        parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["user_id"],
                properties: {
                  user_id: { type: "string", format: "uuid" },
                  reason: { type: "string" },
                  delete_message_days: { type: "integer", minimum: 0, maximum: 7 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "User banned" },
          "403": { description: "Missing BAN_MEMBERS permission" },
        },
      },
    },
    "/servers/{serverId}/audit-log": {
      get: {
        summary: "Fetch server audit log",
        tags: ["Moderation"],
        parameters: [
          { name: "serverId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "before", in: "query", schema: { type: "string", format: "date-time" } },
        ],
        responses: {
          "200": { description: "Audit log entries" },
          "403": { description: "Missing VIEW_AUDIT_LOG permission" },
        },
      },
    },
    // ── Messages ─────────────────────────────────────────────────────────────
    "/messages": {
      post: {
        summary: "Send a message",
        tags: ["Messages"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["channel_id", "content"],
                properties: {
                  channel_id: { type: "string", format: "uuid" },
                  content: { type: "string", maxLength: 4000 },
                  nonce: { type: "string", description: "Client-generated idempotency key" },
                  thread_id: { type: "string", format: "uuid", nullable: true },
                  reply_to: { type: "string", format: "uuid", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Sent message", content: { "application/json": { schema: { $ref: "#/components/schemas/Message" } } } },
          "403": { description: "Missing SEND_MESSAGES permission or member is timed out" },
        },
      },
    },
    "/messages/{messageId}/pin": {
      put: {
        summary: "Pin a message",
        tags: ["Messages"],
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Message pinned" },
          "403": { description: "Missing MANAGE_MESSAGES permission" },
        },
      },
      delete: {
        summary: "Unpin a message",
        tags: ["Messages"],
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Message unpinned" },
          "403": { description: "Missing MANAGE_MESSAGES permission" },
        },
      },
    },
    // ── Threads ───────────────────────────────────────────────────────────────
    "/threads": {
      get: {
        summary: "List threads in a channel",
        tags: ["Threads"],
        parameters: [
          { name: "channel_id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "archived", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: {
          "200": {
            description: "Thread list",
            content: {
              "application/json": {
                schema: { type: "object", properties: { threads: { type: "array", items: { $ref: "#/components/schemas/Thread" } } } },
              },
            },
          },
        },
      },
    },
    "/threads/{threadId}": {
      get: {
        summary: "Get thread details",
        tags: ["Threads"],
        parameters: [{ name: "threadId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Thread", content: { "application/json": { schema: { $ref: "#/components/schemas/Thread" } } } },
          "404": { description: "Thread not found" },
        },
      },
    },
    "/threads/{threadId}/messages": {
      get: {
        summary: "Fetch messages in a thread",
        tags: ["Threads"],
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "before", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": {
            description: "Message list",
            content: {
              "application/json": {
                schema: { type: "object", properties: { messages: { type: "array", items: { $ref: "#/components/schemas/Message" } } } },
              },
            },
          },
        },
      },
    },
    // ── Direct Messages ───────────────────────────────────────────────────────
    "/dm/channels": {
      get: {
        summary: "List DM channels for the current user",
        tags: ["Direct Messages"],
        responses: {
          "200": {
            description: "DM channel list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { channels: { type: "array", items: { $ref: "#/components/schemas/DirectMessageChannel" } } },
                },
              },
            },
          },
        },
      },
    },
    "/dm/channels/{channelId}/messages": {
      get: {
        summary: "Fetch DM messages",
        tags: ["Direct Messages"],
        parameters: [
          { name: "channelId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "before", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": { description: "DM message history" },
          "403": { description: "Not a member of this DM" },
        },
      },
      post: {
        summary: "Send a DM",
        tags: ["Direct Messages"],
        parameters: [{ name: "channelId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["content"],
                properties: { content: { type: "string", maxLength: 4000 } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Sent DM" },
          "403": { description: "Not a member of this DM" },
        },
      },
    },
    // ── Auth ──────────────────────────────────────────────────────────────────
    "/auth/sessions": {
      get: {
        summary: "List active sessions",
        tags: ["Auth"],
        responses: { "200": { description: "Session list" } },
      },
      post: {
        summary: "Create a new session (login)",
        tags: ["Auth"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Session created" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    // ── Friends ───────────────────────────────────────────────────────────────
    "/friends": {
      get: {
        summary: "List friends and pending requests",
        tags: ["Friends"],
        responses: { "200": { description: "Friends list" } },
      },
      post: {
        summary: "Send a friend request",
        tags: ["Friends"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username"],
                properties: { username: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Request sent" },
          "404": { description: "User not found" },
        },
      },
    },
    // ── OpenAPI spec (this endpoint) ──────────────────────────────────────────
    "/docs": {
      get: {
        summary: "OpenAPI specification (authenticated)",
        tags: ["Meta"],
        responses: {
          "200": { description: "This document", content: { "application/json": { schema: { type: "object" } } } },
          "401": { description: "Not authenticated" },
        },
      },
    },
  },
} as const

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json(OPENAPI_SPEC)

  } catch (err) {
    console.error("[docs GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

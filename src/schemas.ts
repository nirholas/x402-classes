/**
 * Per-route request/response schemas published in the x402 402 challenge.
 *
 * The x402scan discovery audit reads `accepts[0].outputSchema.input` and
 * `accepts[0].outputSchema.output` from the *runtime* 402 body, and runtime
 * behaviour is authoritative — so these must not contradict openapi.json.
 * They are generated from `public/openapi.json` ($refs inlined) and keyed
 * exactly like the paywall route map, so they can be spread straight into a
 * route declaration.
 *
 * Regenerate after editing openapi.json rather than hand-editing.
 *
 * `input` follows the x402 Bazaar convention: `{ type: "http", method, ... }`
 * with `pathParams`/`queryParams` for the URL and `bodyType`/`bodyFields` for
 * routes that take a JSON body. `output` is the 200 response schema.
 */

export type RouteSchema = {
  outputSchema: {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  };
};

export const ROUTE_SCHEMAS = {
  "POST /enroll/:classId": {
    outputSchema: {
      input: {
        type: "http",
        method: "POST",
        pathParams: {
          classId: {
            type: "string",
            description: "<templateId>@<YYYY-MM-DD>, e.g. vinyasa-am@2026-08-10"
          }
        },
        bodyType: "json",
        bodyFields: {
          name: {
            type: "string"
          },
          email: {
            type: "string",
            format: "email"
          }
        },
        required: [
          "name"
        ]
      },
      output: {
        type: "object",
        description: "The purchased artifact, returned in the 200 body of POST /enroll/:classId.",
        properties: {
          passId: {
            type: "string"
          },
          seatNumber: {
            type: "integer"
          },
          classDetails: {
            type: "object"
          },
          holder: {
            type: "object"
          },
          seatsLeftAfter: {
            type: "integer"
          },
          passPolicy: {
            type: "object"
          },
          pass: {
            type: "object",
            properties: {
              token: {
                type: "string",
                description: "base64url(canonical payload) + '.' + hex HMAC-SHA256 — the ticket"
              },
              verifyUrl: {
                type: "string",
                format: "uri"
              },
              verifyEndpoint: {
                type: "string"
              },
              expiresAt: {
                type: "string",
                format: "date-time"
              },
              qrSvgDataUri: {
                type: "string",
                description: "QR code of verifyUrl as an SVG data URI; embed directly in <img src>"
              }
            }
          },
          ics: {
            type: "string",
            description: "base64-encoded RFC 5545 calendar invite"
          },
          issuedAt: {
            type: "string",
            format: "date-time"
          },
          signature: {
            type: "string"
          }
        }
      },
    },
  },
} satisfies Record<string, RouteSchema>;

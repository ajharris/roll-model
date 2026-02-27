# API Contracts (v1)

All endpoints require Cognito JWT auth and are fronted by API Gateway REST API (`/prod`). Role is read from the `custom:role` claim.

## Privacy rules and coach limitations
- `sections.private` are never returned to coaches.
- Coaches must be linked to the athlete before they can read entries or post comments.
- `POST /ai/chat` enforces shared-only context for coaches (any `includePrivate` value is ignored).
- Keyword search uses separate partitions for private data (`USER_PRIVATE#{athleteId}`) and is never queried for coaches.
- See `docs/privacy.md` for the full privacy model and behavioral constraints.

## Routes
- `POST /entries`
- `GET /entries`
- `GET /athletes/{athleteId}/entries`
- `POST /entries/comments`
- `POST /links/coach`
- `GET /export`
- `POST /ai/chat`
- `GET /gap-insights`
- `PUT /gap-insights/priorities`
- `GET /athletes/{athleteId}/gap-insights`
- `PUT /athletes/{athleteId}/gap-insights/priorities`
- `GET /curriculum`
- `PUT /curriculum/stages`
- `POST /curriculum/seed`
- `PUT /curriculum/skills/{skillId}`
- `DELETE /curriculum/skills/{skillId}`
- `PUT /curriculum/relationships`
- `DELETE /curriculum/relationships/{fromSkillId}/{toSkillId}`
- `POST /curriculum/progress/recompute`
- `PUT /curriculum/progress/{skillId}/review`
- `GET /athletes/{athleteId}/curriculum`

## `POST /entries`
Create a training entry.
- **Role**: `athlete`

**Request JSON schema**
```json
{
  "type": "object",
  "required": ["sections", "sessionMetrics"],
  "properties": {
    "sections": {
      "type": "object",
      "required": ["private", "shared"],
      "properties": {
        "private": {"type": "string"},
        "shared": {"type": "string"}
      }
    },
    "sessionMetrics": {
      "type": "object",
      "required": ["durationMinutes", "intensity", "rounds", "giOrNoGi", "tags"],
      "properties": {
        "durationMinutes": {"type": "number"},
        "intensity": {"type": "number"},
        "rounds": {"type": "number"},
        "giOrNoGi": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}}
      }
    }
  }
}
```

**Response JSON schema (201)**
```json
{
  "type": "object",
  "required": ["entry"],
  "properties": {
    "entry": {"$ref": "#/definitions/Entry"}
  },
  "definitions": {
    "Entry": {
      "type": "object",
      "required": ["entryId", "athleteId", "createdAt", "updatedAt", "sections", "sessionMetrics"],
      "properties": {
        "entryId": {"type": "string"},
        "athleteId": {"type": "string"},
        "createdAt": {"type": "string"},
        "updatedAt": {"type": "string"},
        "sections": {
          "type": "object",
          "required": ["private", "shared"],
          "properties": {
            "private": {"type": "string"},
            "shared": {"type": "string"}
          }
        },
        "sessionMetrics": {
          "type": "object",
          "required": ["durationMinutes", "intensity", "rounds", "giOrNoGi", "tags"],
          "properties": {
            "durationMinutes": {"type": "number"},
            "intensity": {"type": "number"},
            "rounds": {"type": "number"},
            "giOrNoGi": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}}
          }
        }
      }
    }
  }
}
```

## `GET /entries`
Fetch entries for the authenticated athlete.
- **Role**: `athlete`

**Response JSON schema (200)**
```json
{
  "type": "object",
  "required": ["entries"],
  "properties": {
    "entries": {
      "type": "array",
      "items": {"$ref": "#/definitions/Entry"}
    }
  },
  "definitions": {
    "Entry": {"$ref": "#/definitions/Entry"}
  }
}
```

## `GET /athletes/{athleteId}/entries`
Fetch shared-only entries for a linked athlete.
- **Role**: `coach`

**Response JSON schema (200)**
```json
{
  "type": "object",
  "required": ["entries"],
  "properties": {
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["entryId", "athleteId", "createdAt", "updatedAt", "sections", "sessionMetrics"],
        "properties": {
          "entryId": {"type": "string"},
          "athleteId": {"type": "string"},
          "createdAt": {"type": "string"},
          "updatedAt": {"type": "string"},
          "sections": {
            "type": "object",
            "required": ["shared"],
            "properties": {
              "shared": {"type": "string"}
            }
          },
          "sessionMetrics": {
            "type": "object",
            "required": ["durationMinutes", "intensity", "rounds", "giOrNoGi", "tags"],
            "properties": {
              "durationMinutes": {"type": "number"},
              "intensity": {"type": "number"},
              "rounds": {"type": "number"},
              "giOrNoGi": {"type": "string"},
              "tags": {"type": "array", "items": {"type": "string"}}
            }
          }
        }
      }
    }
  }
}
```

## `POST /entries/comments`
Create a coach comment on an entry.
- **Role**: `coach`

**Request JSON schema**
```json
{
  "type": "object",
  "required": ["entryId", "body"],
  "properties": {
    "entryId": {"type": "string"},
    "body": {"type": "string", "minLength": 1}
  }
}
```

**Response JSON schema (201)**
```json
{
  "type": "object",
  "required": ["comment"],
  "properties": {
    "comment": {
      "type": "object",
      "required": ["commentId", "entryId", "coachId", "createdAt", "body", "visibility"],
      "properties": {
        "commentId": {"type": "string"},
        "entryId": {"type": "string"},
        "coachId": {"type": "string"},
        "createdAt": {"type": "string"},
        "body": {"type": "string"},
        "visibility": {"type": "string", "enum": ["visible", "hiddenByAthlete"]}
      }
    }
  }
}
```

## `POST /links/coach`
Link an athlete to a coach.
- **Role**: `athlete`

**Request JSON schema**
```json
{
  "type": "object",
  "required": ["coachId"],
  "properties": {
    "coachId": {"type": "string", "minLength": 1}
  }
}
```

**Response JSON schema (201)**
```json
{
  "type": "object",
  "required": ["linked", "athleteId", "coachId"],
  "properties": {
    "linked": {"type": "boolean"},
    "athleteId": {"type": "string"},
    "coachId": {"type": "string"}
  }
}
```

## `GET /export`
Return a full or tidy export for the authenticated athlete.
- **Role**: `athlete`

**Query parameters**
- `mode` (optional): `full` or `tidy`. If omitted, both are returned.

**Notes**
- `full` is raw entities grouped into arrays.
- `tidy` is analysis-ready normalized arrays plus relationship tables.
- Tidy ordering is deterministic based on DynamoDB sort keys: entries by `ENTRY#...`, comments by `COMMENT#...` within each entry, threads by `AI_THREAD#...`, messages by `MSG#...` within each thread.

**Response JSON schema (200)**
```json
{
  "type": "object",
  "required": ["schemaVersion", "generatedAt"],
  "properties": {
    "schemaVersion": {"type": "string"},
    "generatedAt": {"type": "string"},
    "full": {
      "type": "object",
      "required": ["athleteId", "entries", "comments", "links", "aiThreads", "aiMessages"],
      "properties": {
        "athleteId": {"type": "string"},
        "entries": {
          "type": "array",
          "items": {"$ref": "#/definitions/Entry"}
        },
        "comments": {
          "type": "array",
          "items": {"$ref": "#/definitions/Comment"}
        },
        "links": {
          "type": "array",
          "items": {"$ref": "#/definitions/CoachLink"}
        },
        "aiThreads": {
          "type": "array",
          "items": {"$ref": "#/definitions/AIThread"}
        },
        "aiMessages": {
          "type": "array",
          "items": {"$ref": "#/definitions/AIMessage"}
        }
      }
    },
    "tidy": {
      "type": "object",
      "required": ["athlete", "entries", "comments", "links", "aiThreads", "aiMessages", "relationships"],
      "properties": {
        "athlete": {
          "type": "object",
          "required": ["athleteId"],
          "properties": {
            "athleteId": {"type": "string"}
          }
        },
        "entries": {
          "type": "array",
          "items": {"$ref": "#/definitions/Entry"}
        },
        "comments": {
          "type": "array",
          "items": {"$ref": "#/definitions/Comment"}
        },
        "links": {
          "type": "array",
          "items": {"$ref": "#/definitions/CoachLink"}
        },
        "aiThreads": {
          "type": "array",
          "items": {"$ref": "#/definitions/AIThread"}
        },
        "aiMessages": {
          "type": "array",
          "items": {"$ref": "#/definitions/AIMessage"}
        },
        "relationships": {
          "type": "object",
          "required": ["entryComments", "threadMessages"],
          "properties": {
            "entryComments": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["entryId", "commentIds"],
                "properties": {
                  "entryId": {"type": "string"},
                  "commentIds": {"type": "array", "items": {"type": "string"}}
                }
              }
            },
            "threadMessages": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["threadId", "messageIds"],
                "properties": {
                  "threadId": {"type": "string"},
                  "messageIds": {"type": "array", "items": {"type": "string"}}
                }
              }
            }
          }
        }
      }
    }
  },
  "definitions": {
    "Entry": {
      "type": "object",
      "required": ["entryId", "athleteId", "createdAt", "updatedAt", "sections", "sessionMetrics"],
      "properties": {
        "entryId": {"type": "string"},
        "athleteId": {"type": "string"},
        "createdAt": {"type": "string"},
        "updatedAt": {"type": "string"},
        "sections": {
          "type": "object",
          "required": ["private", "shared"],
          "properties": {
            "private": {"type": "string"},
            "shared": {"type": "string"}
          }
        },
        "sessionMetrics": {
          "type": "object",
          "required": ["durationMinutes", "intensity", "rounds", "giOrNoGi", "tags"],
          "properties": {
            "durationMinutes": {"type": "number"},
            "intensity": {"type": "number"},
            "rounds": {"type": "number"},
            "giOrNoGi": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}}
          }
        }
      }
    },
    "Comment": {
      "type": "object",
      "required": ["commentId", "entryId", "coachId", "createdAt", "body", "visibility"],
      "properties": {
        "commentId": {"type": "string"},
        "entryId": {"type": "string"},
        "coachId": {"type": "string"},
        "createdAt": {"type": "string"},
        "body": {"type": "string"},
        "visibility": {"type": "string", "enum": ["visible", "hiddenByAthlete"]}
      }
    },
    "CoachLink": {
      "type": "object",
      "required": ["athleteId", "coachId", "createdAt"],
      "properties": {
        "athleteId": {"type": "string"},
        "coachId": {"type": "string"},
        "createdAt": {"type": "string"}
      }
    },
    "AIThread": {
      "type": "object",
      "required": ["threadId", "title", "createdAt", "lastActiveAt"],
      "properties": {
        "threadId": {"type": "string"},
        "title": {"type": "string"},
        "createdAt": {"type": "string"},
        "lastActiveAt": {"type": "string"}
      }
    },
    "AIMessage": {
      "type": "object",
      "required": ["messageId", "threadId", "role", "content", "visibilityScope", "createdAt"],
      "properties": {
        "messageId": {"type": "string"},
        "threadId": {"type": "string"},
        "role": {"type": "string", "enum": ["user", "assistant"]},
        "content": {"type": "string"},
        "visibilityScope": {"type": "string", "enum": ["private", "shared"]},
        "createdAt": {"type": "string"}
      }
    }
  }
}
```

## `GET /gap-insights`
Return gap-analysis insights based on stored structured records.
- **Role**: `athlete` (or `coach` via `/athletes/{athleteId}/gap-insights` for linked athletes)
- **Query params (optional)**:
  - `staleDays` (default `30`)
  - `lookbackDays` (default `30`)
  - `repeatFailureWindowDays` (default `30`)
  - `repeatFailureMinCount` (default `2`)
  - `topN` (default `10`)

**Response shape (200, abbreviated)**
```json
{
  "report": {
    "athleteId": "string",
    "generatedAt": "string",
    "thresholds": {
      "staleDays": 30,
      "lookbackDays": 30,
      "repeatFailureWindowDays": 30,
      "repeatFailureMinCount": 2,
      "topN": 10
    },
    "summary": {
      "totalGaps": 0,
      "staleSkillCount": 0,
      "repeatedFailureCount": 0,
      "notTrainingCount": 0
    },
    "sections": {
      "notTraining": [],
      "staleSkills": [],
      "repeatedFailures": []
    },
    "ranked": [],
    "weeklyFocus": {
      "headline": "string",
      "items": []
    }
  }
}
```

## `PUT /gap-insights/priorities`
Persist athlete/coach priority decisions for gap items.
- **Role**: `athlete` (or `coach` via `/athletes/{athleteId}/gap-insights/priorities` for linked athletes)

**Request**
```json
{
  "priorities": [
    {
      "gapId": "stale-skill:knee-cut",
      "status": "accepted",
      "manualPriority": 1,
      "note": "Make this week 1 focus"
    }
  ]
}
```

**Response (200)**
```json
{
  "saved": [
    {
      "gapId": "stale-skill:knee-cut",
      "status": "accepted",
      "manualPriority": 1,
      "note": "Make this week 1 focus",
      "updatedAt": "string",
      "updatedBy": "string",
      "updatedByRole": "athlete"
    }
  ]
}
```

## `POST /ai/chat`
Chat endpoint for AI-assisted post-training analysis.
- **Role**: `athlete` or `coach`

**Request JSON schema**
```json
{
  "type": "object",
  "required": ["message"],
  "properties": {
    "threadId": {"type": "string"},
    "message": {"type": "string", "minLength": 1},
    "context": {
      "type": "object",
      "properties": {
        "athleteId": {"type": "string"},
        "entryIds": {"type": "array", "items": {"type": "string"}},
        "dateRange": {
          "type": "object",
          "properties": {
            "from": {"type": "string"},
            "to": {"type": "string"}
          }
        },
        "includePrivate": {"type": "boolean"},
        "keywords": {"type": "array", "items": {"type": "string"}}
      }
    }
  }
}
```

**Response JSON schema (200)**
```json
{
  "type": "object",
  "required": ["threadId", "assistant_text", "extracted_updates", "suggested_prompts"],
  "properties": {
    "threadId": {"type": "string"},
    "assistant_text": {"type": "string"},
    "extracted_updates": {
      "type": "object",
      "required": ["summary", "detectedTopics", "followUpActions"],
      "properties": {
        "summary": {"type": "string"},
        "detectedTopics": {"type": "array", "items": {"type": "string"}},
        "recommendedIntensity": {"type": "number"},
        "followUpActions": {"type": "array", "items": {"type": "string"}}
      }
    },
    "suggested_prompts": {"type": "array", "items": {"type": "string"}}
  }
}
```

**Retrieval behavior**
- Default context uses latest 10 entries plus latest 20 messages in the thread.
- Keyword search considers up to 8 unique tokens and up to 10 matched entries by overlap and recency.

## Error format and codes
**Error JSON schema**
```json
{
  "type": "object",
  "required": ["error"],
  "properties": {
    "error": {
      "type": "object",
      "required": ["code", "message"],
      "properties": {
        "code": {"type": "string"},
        "message": {"type": "string"}
      }
    }
  }
}
```

**Codes emitted**
- `UNAUTHORIZED` (401) missing auth claims
- `INVALID_ROLE` (403) role claim is invalid
- `FORBIDDEN` (403) role not allowed or coach not linked to athlete
- `INVALID_REQUEST` (400) missing/invalid body or parameters
- `NOT_FOUND` (404) entry or thread not found
- `INTERNAL_SERVER_ERROR` (500) unexpected errors

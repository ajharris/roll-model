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
- `POST /weekly-plans/build`
- `GET /weekly-plans`
- `PUT /weekly-plans/{planId}`
- `POST /athletes/{athleteId}/weekly-plans/build`
- `GET /athletes/{athleteId}/weekly-plans`
- `PUT /athletes/{athleteId}/weekly-plans/{planId}`
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
- **Query options**:
  - `recentOneThingLimit` (optional, `1..20`): include `recentOneThingCues` in response.

**Response JSON schema (200)**
```json
{
  "type": "object",
  "required": ["entries"],
  "properties": {
    "entries": {
      "type": "array",
      "items": {"$ref": "#/definitions/Entry"}
    },
    "recentOneThingCues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["entryId", "createdAt", "cue"],
        "properties": {
          "entryId": {"type": "string"},
          "createdAt": {"type": "string"},
          "cue": {"type": "string"}
        }
      }
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

## `POST /weekly-plans/build`
Generate and persist the current weekly plan and positional-round focus artifact from recent GPT-processed logs + plan context.
- **Role**: `athlete` (or `coach` via `/athletes/{athleteId}/weekly-plans/build` for linked athletes)

**Request JSON schema**
```json
{
  "type": "object",
  "properties": {
    "weekOf": {"type": "string"}
  }
}
```

**Response JSON schema (201)**
```json
{
  "type": "object",
  "required": ["plan"],
  "properties": {
    "plan": {"$ref": "#/definitions/WeeklyPlan"}
  },
  "definitions": {
    "WeeklyPlan": {
      "type": "object",
      "required": ["planId", "athleteId", "weekOf", "status", "positionalFocus"],
      "properties": {
        "planId": {"type": "string"},
        "athleteId": {"type": "string"},
        "weekOf": {"type": "string"},
        "status": {"type": "string", "enum": ["draft", "active", "completed"]},
        "primarySkills": {"type": "array", "items": {"type": "string"}},
        "supportingConcept": {"type": "string"},
        "conditioningConstraint": {"type": "string"},
        "positionalFocus": {
          "type": "object",
          "required": ["cards", "locked", "updatedAt"],
          "properties": {
            "locked": {"type": "boolean"},
            "lockedAt": {"type": "string"},
            "lockedBy": {"type": "string"},
            "updatedAt": {"type": "string"},
            "cards": {
              "type": "array",
              "items": {"$ref": "#/definitions/WeeklyPositionalFocusCard"}
            }
          }
        }
      }
    },
    "WeeklyPositionalFocusCard": {
      "type": "object",
      "required": [
        "id",
        "title",
        "focusType",
        "priority",
        "position",
        "context",
        "successCriteria",
        "rationale",
        "linkedOneThingCues",
        "recurringFailures",
        "references",
        "status"
      ],
      "properties": {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "focusType": {"type": "string", "enum": ["remediate-weakness", "reinforce-strength", "carry-over"]},
        "priority": {"type": "integer", "minimum": 1},
        "position": {"type": "string"},
        "context": {"type": "string"},
        "successCriteria": {"type": "array", "items": {"type": "string"}},
        "rationale": {"type": "string"},
        "linkedOneThingCues": {"type": "array", "items": {"type": "string"}},
        "recurringFailures": {"type": "array", "items": {"type": "string"}},
        "references": {"type": "array", "items": {"type": "object"}},
        "status": {"type": "string", "enum": ["pending", "done", "skipped"]},
        "coachNote": {"type": "string"}
      }
    }
  }
}
```

## `GET /weekly-plans`
List weekly plans for the authenticated athlete (or for linked athlete under `/athletes/{athleteId}/weekly-plans`).
- **Role**: `athlete` or `coach`

**Response JSON schema (200)**
```json
{
  "type": "object",
  "required": ["plans"],
  "properties": {
    "plans": {
      "type": "array",
      "items": {"$ref": "#/definitions/WeeklyPlan"}
    }
  }
}
```

## `PUT /weekly-plans/{planId}`
Update weekly plan execution and optional positional-focus review edits.
- **Role**: `athlete` or `coach` (coach via `/athletes/{athleteId}/weekly-plans/{planId}` for linked athletes)

**Request JSON schema**
```json
{
  "type": "object",
  "properties": {
    "status": {"type": "string", "enum": ["draft", "active", "completed"]},
    "coachReviewNote": {"type": "string"},
    "completionNotes": {"type": "string"},
    "lockPositionalFocus": {"type": "boolean"},
    "positionalFocusCards": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id"],
        "properties": {
          "id": {"type": "string"},
          "priority": {"type": "integer", "minimum": 1},
          "title": {"type": "string"},
          "position": {"type": "string"},
          "context": {"type": "string"},
          "successCriteria": {"type": "array", "items": {"type": "string"}},
          "rationale": {"type": "string"},
          "status": {"type": "string", "enum": ["pending", "done", "skipped"]},
          "coachNote": {"type": "string"}
        }
      }
    }
  }
}
```

**Rules**
- Coaches can review/edit card priorities/content before lock.
- Locked positional focus cards reject further priority/content changes.
- Athlete lock (`lockPositionalFocus=true`) freezes card priorities/content for that week.

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

## `POST /feedback`
Submit structured in-app feature/bug feedback from authenticated users.
- **Role**: `athlete`, `coach`, or `admin`
- **Auth gate**: Cognito JWT required.

**Request JSON schema**
```json
{
  "type": "object",
  "required": [
    "type",
    "problem",
    "proposedChange",
    "contextSteps",
    "severity",
    "screenshots",
    "previewConfirmed"
  ],
  "properties": {
    "type": {"type": "string", "enum": ["bug", "feature"]},
    "problem": {"type": "string", "minLength": 12, "maxLength": 3000},
    "proposedChange": {"type": "string", "minLength": 12, "maxLength": 3000},
    "contextSteps": {"type": "string", "minLength": 12, "maxLength": 3000},
    "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
    "screenshots": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["url"],
        "properties": {
          "url": {"type": "string", "pattern": "^https://"},
          "caption": {"type": "string", "maxLength": 240}
        }
      }
    },
    "reviewerWorkflow": {
      "type": "object",
      "properties": {
        "requiresReview": {"type": "boolean"},
        "reviewerRole": {"type": "string", "enum": ["coach", "admin"]},
        "note": {"type": "string", "maxLength": 500}
      }
    },
    "normalization": {
      "type": "object",
      "properties": {
        "usedGpt": {"type": "boolean"},
        "originalProblem": {"type": "string"},
        "originalProposedChange": {"type": "string"}
      }
    },
    "previewConfirmed": {"type": "boolean", "const": true}
  }
}
```

**Response JSON schema (201)**
```json
{
  "type": "object",
  "required": ["feedbackId", "issueNumber", "issueUrl"],
  "properties": {
    "feedbackId": {"type": "string"},
    "issueNumber": {"type": "integer"},
    "issueUrl": {"type": "string"}
  }
}
```

**Storage + automation linkage**
- Final payloads are persisted in DynamoDB as `FEEDBACK_SUBMISSION` records.
- Each stored payload includes reporter metadata plus linked GitHub issue number/URL for downstream issue automation.
- Reviewer-routing submissions are marked `pending_reviewer_validation` and labeled for coach/admin triage.

**Attachment strategy**
- Current strategy is URL-based screenshot references (`https://...`) in payload and issue body.
- This keeps submissions lightweight while preserving deterministic references for reviewers and issue automation.
- File upload can be added later with pre-signed object storage URLs without changing reviewer workflow semantics.

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

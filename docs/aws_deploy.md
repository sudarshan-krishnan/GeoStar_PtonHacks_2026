# Running PlotStar on AWS

Status: the code paths below exist; nothing has been deployed or run against AWS from this repo (no AWS
credentials were available while building). Treat this as a checklist, not a verified runbook.

## Claude through Amazon Bedrock

Set in `.env` (and leave `ANTHROPIC_API_KEY` empty to force the Bedrock path):

```
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=<the Claude model or inference-profile id enabled in your account>
AWS_ACCESS_KEY_ID=...        # or AWS_PROFILE, or an instance/task role
AWS_SECRET_ACCESS_KEY=...
```

- Explainer agent (`app/agent.py`): `ChatBedrockConverse` inside the LangChain deep agent, same four tools.
- Facility design (`app/routers/design.py`): `anthropic.AnthropicBedrock`.
- Check which path is live: `GET /agent/status` and the "Laid out by …" line in the Design step.

## Backend container

`services/api/Dockerfile` builds the FastAPI service. The CoStar kit is licensed data: do not bake it into an
image or push it to a public registry. Mount it (EFS, or a private S3 sync at start) and point `COSTAR_KIT_DIR`
at it; run `python -m app.costar.loader` once to build the SQLite store on a persistent volume.

Suggested shape for the demo: ECR (private) -> App Runner or one ECS Fargate task, secrets from Secrets Manager,
the Next.js app on Amplify or the same task with `NEXT_PUBLIC_API_URL` set to the API URL. Add the deployed
domain to the Matterport SDK allowlist and to `CORS_ORIGINS`.

Keep a local fallback for judging: everything the demo needs is cached in `data/cache/`.

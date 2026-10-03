# Re-Watt Energy Deployment Guide

This guide provides step-by-step instructions to deploy the Re-Watt Energy marketplace to Render.com and access it live on the internet.

---

## Quick Summary

The Re-Watt Energy application is a full-stack marketplace with:
- **Backend**: FastAPI (Python) with PostgreSQL database
- **Frontend**: React TypeScript SPA
- **Infrastructure**: Render.com (auto-configures via `render.yaml`)

**Frontend URL** (after the Blueprint is deployed successfully): [https://rewatt-marketplace.onrender.com](https://rewatt-marketplace.onrender.com)

The Render URL has not been activated merely by adding `render.yaml` to GitHub. The Blueprint must be created in Render and both services must reach **Live** before this address serves the application.

---

## Prerequisites

1. **GitHub Account** - with this repository connected
2. **Render.com Account** - free tier available at https://render.com
3. **GitHub Repository Access** - you should have push access to `h98982360-cell/re-watt-energy`

---

## Step 1: Create the Render Blueprint

1. Visit https://dashboard.render.com
2. Select **New > Blueprint** (do not create only a Web Service)
3. Connect GitHub and authorize Render to access the repository
4. Select **`h98982360-cell/re-watt-energy`** and its root-level `render.yaml`
5. Review the API, frontend static site, database, and prompted admin credentials
6. Apply the Blueprint to create and deploy all resources

## Step 2: Render Auto-Configures Services

Applying the Blueprint reads `render.yaml` and creates the following resources. A push to GitHub alone does not create these services:

1. **rewatt-api** service (FastAPI backend)
   - Runtime: Python 3.12
   - Build command: `pip install -r requirements.txt` (service root: `backend`)
   - Start command initializes the schema, then starts Uvicorn
   - Health check: `/health`

2. **rewatt-marketplace** service (React frontend)
   - Static site deployment
   - Build command: `npm ci && npm run build` (service root: `frontend`)
   - Serves files from `dist/`; all app routes rewrite to `index.html`
   - Gets the API host from the `rewatt-api` service reference at build time

3. **PostgreSQL Database**
   - Auto-provisioned with free tier
   - Environment variable: `DATABASE_URL` (auto-populated)

---

## Step 3: Set Environment Variables

The Blueprint dynamically wires the API host and frontend CORS host. During first-time Blueprint creation, provide the admin credentials prompted by Render:

### For the `rewatt-api` service:

1. In Render dashboard, click on **rewatt-api** service
2. Go to **Environment** tab
3. Add or update these variables:

```
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=YourSecureAdminPassword123
ADMIN_NAME=Re-Watt Administrator
EXPOSE_VERIFICATION_CODES=false
```

**Important:** Use a unique admin password of at least 12 characters. Render generates `SECRET_KEY` automatically. `DATABASE_URL`, `VITE_API_URL`, and the API's CORS origin are wired through the Blueprint; do not replace those references with guessed hostnames.

### Automatically Set by Render:
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Service port (auto-assigned)

---

## Step 4: Deploy

1. Apply/create the Blueprint and start its initial deploy
2. Wait for the database, API, and static site to deploy (free services can take several minutes to wake up)
3. Check service status:
   - `rewatt-api` should show "Live" (green)
   - `rewatt-marketplace` should show "Live" (green)
4. Open the generated static-site URL; if it differs from `https://rewatt-marketplace.onrender.com`, use the service URL shown in Render. Check the API's `/health` route before testing login.

---

## Step 5: Verify Deployment

### Test Backend Health

Open in your browser or use curl:

```bash
curl https://<rewatt-api-url>/health
```

Expected response:
```json
{"status":"ok"}
```

### Test Frontend

Open the static-site URL displayed by Render (the expected default is `https://rewatt-marketplace.onrender.com`).

You should see:
- Landing page with Re-Watt logo
- Authentication modals (Sign Up / Log In)
- Proof of concept section

### Access API Documentation

Visit: `https://<rewatt-api-url>/docs`

You'll see interactive Swagger UI for all API endpoints.

---

## Step 6: End-to-End Workflow Test

### 1. Register a Supplier

1. Open the deployed static-site URL shown in Render
2. Click **"Supplier Sign Up"**
3. Fill in:
   - Name: "Test Supplier"
   - Email: "supplier@example.com"
   - Password: "TestPassword123"
   - Organization: "Test Farm"
   - County: "Kiambu"
4. Click **Sign Up**

### 2. Register a Buyer

Repeat steps 1-4 with role **"Buyer"** and different email.

### 3. Admin Verification

1. Open `https://<rewatt-api-url>/docs`
2. Try out POST `/api/auth/login`:
   - Email: `admin@example.com`
   - Password: (the password you set in env vars)
3. Copy the `access_token` from response
4. Go to GET `/api/admin/verifications/pending`
5. Click **"Authorize"** and paste token
6. Execute - you should see pending suppliers and buyers
7. Go to PATCH `/api/admin/verifications/{user_id}`
   - Enter the supplier's user_id
   - Decision: `"verified"`
   - Execute

### 4. Supplier Creates Listing

1. Log in as supplier at the deployed static-site URL
2. Click **Listings** in sidebar
3. Click **"Create Listing"**
4. Fill in:
   - Material: "Maize Cobs"
   - Quantity: 500
   - Unit: "kg"
   - Condition: "Dry"
   - County: "Kiambu"
5. Click **Submit**

### 5. Buyer Posts Requirement

1. Log in as buyer
2. Click **Requirements** in sidebar
3. Click **"Post Requirement"**
4. Fill in:
   - Material: "Maize Cobs"
   - Quantity: 800
   - Unit: "kg"
5. Click **Submit**

### 6. Buyer Reviews Matches

1. Still logged in as buyer
2. Click **Matches** in sidebar
3. You should see the supplier's 500 kg listed (aggregated match)
4. Click **"Accept Match"** (or review before accepting)

### 7. Supplier Accepts

1. Log in as supplier
2. Click **Matches** in sidebar
3. View the buyer's requirement and accept

### 8. Transaction Complete

1. Both users can see the transaction in **Transactions** tab
2. Buyer can confirm receipt
3. Payment reference can be recorded
4. Transaction status moves to "Completed"

---

## Common Issues and Solutions

### Frontend Shows 404 or Blank Page
- **Cause**: SPA routing not configured
- **Solution**: Already handled in `render.yaml` with `try_files` rule; if issue persists, restart service

### "Cannot connect to API" Error in Frontend
- **Cause**: CORS blocked or API URL wrong
- **Solution**:
  1. Confirm the API service's `CORS_ORIGINS` references the actual static-site host through the Blueprint
  2. Verify API service is running (check Render dashboard)
  3. Check browser console for exact error URL

### Database Connection Refused
- **Cause**: PostgreSQL not initialized
- **Solution**:
  1. Check `DATABASE_URL` env var is set
  2. Restart the `rewatt-api` service (Render will reinitialize)
  3. Check Render logs for errors

### Admin Account Not Working
- **Cause**: Env vars not set or app not restarted
- **Solution**:
  1. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` in env vars
  2. Restart the `rewatt-api` service (Render redeploys)
  3. Wait 2-3 minutes for service to come online

### Verification Codes Not Appearing
- **Cause**: `EXPOSE_VERIFICATION_CODES` is false
- **Solution**: In dev/testing, set to `true` (change back to `false` in production)

---

## Monitoring and Logs

### View Service Logs

1. In Render dashboard, click on a service
2. Go to **Logs** tab
3. Watch real-time log output as users interact

### Common Log Messages

- `INFO: Application startup complete` - backend ready
- `INFO: Uvicorn running on ...` - API listening
- Database initialization messages - tables created

---

## Scaling and Performance

### Current Configuration (Free Tier)

- Backend: 1 instance, 0.5 GB RAM, auto-scaling available
- Frontend: Static site (CDN-backed)
- Database: PostgreSQL free tier (500 MB)

### Upgrade Steps

1. In Render dashboard, click on service
2. Go to **Settings** tab
3. Select higher tier (paid options available)
4. Redeploy

---

## Security Checklist

Before going production:

- [x] `EXPOSE_VERIFICATION_CODES=false` (set in prod)
- [x] `CORS_ORIGINS` restricted to your domain only
- [x] `SECRET_KEY` is unique and strong (min 32 chars)
- [x] Admin password changed from default
- [x] Database backups enabled (Render provides)
- [x] HTTPS enforced (Render auto-enables)
- [x] No secrets in frontend bundle (not applicable—all env in backend)

---

## Useful Links

- **Render Dashboard**: https://dashboard.render.com
- **API Documentation**: `https://<rewatt-api-url>/docs`
- **GitHub Repository**: https://github.com/h98982360-cell/re-watt-energy
- **Re-Watt Energy Main Site**: (to be added)

---

## Support

If deployment fails:

1. **Check Render logs** for error messages
2. **Verify all env vars** are set correctly
3. **Restart services** via Render dashboard
4. **Review this guide** for common issues
5. **Check GitHub Issues** for known problems

---

## Next Steps After Deployment

1. **Seed test data** via admin dashboard
2. **Invite beta users** with verification codes
3. **Monitor logs** for any errors
4. **Collect user feedback** on live platform
5. **Plan Phase 2** expansion (additional materials, regions)

---

**Deployment completed! Your Re-Watt Energy marketplace is now LIVE. 🚀**

Visit the static-site URL shown in your Render dashboard after the Blueprint is Live.

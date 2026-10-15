# Re-Watt Energy

Re-Watt Energy connects farmers and other suppliers of recoverable materials with businesses that need them. It helps suppliers combine small quantities of biomass into larger orders, making it easier to sell agricultural waste and giving businesses a reliable way to source materials.

The MVP focuses on maize cobs for biomass processors, with support for e-waste reuse and recycling.

## Features

- **Material listings:** Suppliers list materials, quantities, location, and availability.
- **Buyer requests:** Businesses post the materials and quantities they need.
- **Supply matching:** Finds suitable listings and combines smaller supplies to meet buyer requirements.
- **AI insights:** Helps users assess materials and potential matches.
- **Transaction tracking:** Users can review matches and track transaction status.
- **Role-based workspaces:** Separate interfaces for suppliers, buyers, and admins.

## Tech Stack

- React, TypeScript, Vite
- Python, FastAPI
- PostgreSQL and SQLite
- AI language model API

## Run Locally

### Requirements

Python 3.11+, Node.js 18.18+, and npm.

### 1. Start the backend

From the project root:

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --reload

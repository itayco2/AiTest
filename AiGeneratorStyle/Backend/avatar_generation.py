# Backend/avatar_generation.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

app = FastAPI(title="Avatar Generation API - Deprecated")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/avatar/generate")
async def generate_avatar():
    """This endpoint has been moved to the main API"""
    raise HTTPException(
        status_code=301, 
        detail="This endpoint has been moved. Please use http://localhost:8000/api/avatar/generate"
    )

@app.get("/")
async def root():
    return {
        "message": "This service is deprecated. Please use the main API at http://localhost:8000",
        "status": "deprecated"
    }

if __name__ == "__main__":
    import uvicorn
    print("⚠️  WARNING: This service is deprecated. Use main.py instead.")
    uvicorn.run(app, host="0.0.0.0", port=8001)  # Different port to avoid conflicts
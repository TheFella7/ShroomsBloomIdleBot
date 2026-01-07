import os
import uuid
import json
from datetime import datetime
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
import paypalrestsdk
from pydantic import BaseModel

app = FastAPI()

# CORS for Telegram WebApp
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# PayPal Configuration
paypalrestsdk.configure({
    "mode": "sandbox",  # Change to "live" for production
    "client_id": "AZI8htKGPMC31G4pZqPotLQ4kz6uXiPy9qCCj8N822BCFjf6hVmVNFU2eIgVPJGvaB_1GRPCTM6rJK9t",
    "client_secret": os.getenv("PAYPAL_SECRET")  # Set in environment
})

# Database connection
def get_db():
    return psycopg2.connect(os.getenv("DATABASE_URL"))

# Models
class CreateOrderRequest(BaseModel):
    telegram_user_id: int
    amount: float = 10.00
    gems: int = 100

class WebhookEvent(BaseModel):
    event_type: str
    resource: dict

@app.post("/create-order")
async def create_order(data: CreateOrderRequest):
    """Create PayPal order and store in database"""
    
    # Create unique order ID
    order_id = f"SHROOM_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    # Create PayPal order
    payment = paypalrestsdk.Payment({
        "intent": "sale",
        "payer": {
            "payment_method": "paypal"
        },
        "transactions": [{
            "amount": {
                "total": str(data.amount),
                "currency": "USD"
            },
            "description": f"{data.gems} Shroom Bloom Gems",
            "custom": json.dumps({
                "telegram_user_id": data.telegram_user_id,
                "order_id": order_id,
                "gems": data.gems
            })
        }],
        "redirect_urls": {
            "return_url": f"{os.getenv('WEBAPP_URL')}/success",
            "cancel_url": f"{os.getenv('WEBAPP_URL')}/cancel"
        }
    })
    
    if payment.create():
        # Store in database
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO purchases 
                    (player_id, paypal_order_id, amount_gbp, status, telegram_user_id, created_at)
                    VALUES (
                        (SELECT id FROM players WHERE telegram_user_id = %s),
                        %s, %s, 'pending', %s, NOW()
                    )
                """, (data.telegram_user_id, payment.id, data.amount, data.telegram_user_id))
                conn.commit()
        finally:
            conn.close()
        
        return {
            "success": True,
            "order_id": payment.id,
            "approval_url": next(link.href for link in payment.links if link.rel == "approval_url")
        }
    else:
        return {"success": False, "error": payment.error}

@app.post("/capture-payment/{order_id}")
async def capture_payment(order_id: str):
    """Capture authorized PayPal payment"""
    payment = paypalrestsdk.Payment.find(order_id)
    
    if payment.execute({"payer_id": payment.payer.payer_info.payer_id}):
        # Update database
        conn = get_db()
        try:
            with conn.cursor() as cur:
                # Get transaction details
                transaction = payment.transactions[0]
                custom_data = json.loads(transaction.custom)
                
                # Update purchase
                cur.execute("""
                    UPDATE purchases 
                    SET status = 'completed',
                        paypal_status = %s,
                        paypal_capture_id = %s
                    WHERE paypal_order_id = %s
                """, (payment.state, payment.id, order_id))
                
                # Credit gems to user
                cur.execute("""
                    UPDATE players 
                    SET gems = gems + %s
                    WHERE telegram_user_id = %s
                """, (custom_data['gems'], custom_data['telegram_user_id']))
                
                conn.commit()
                
                # TODO: Notify Telegram bot via webhook
                
                return {
                    "success": True,
                    "payment_id": payment.id,
                    "state": payment.state,
                    "user_id": custom_data['telegram_user_id'],
                    "gems": custom_data['gems']
                }
        finally:
            conn.close()
    
    return {"success": False, "error": payment.error}

@app.post("/paypal-webhook")
async def paypal_webhook(request: Request):
    """Handle PayPal webhook events"""
    body = await request.json()
    
    # Verify webhook signature (implement with PayPal SDK)
    # For now, log and process
    
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Store webhook event
            cur.execute("""
                INSERT INTO paypal_webhook_events 
                (event_id, event_type, resource_type, summary, resource, status)
                VALUES (%s, %s, %s, %s, %s, 'received')
                ON CONFLICT (event_id) DO NOTHING
            """, (
                body.get('id'),
                body.get('event_type'),
                body.get('resource_type'),
                body.get('summary'),
                json.dumps(body.get('resource', {}))
            ))
            
            # Process specific events
            if body.get('event_type') == 'PAYMENT.CAPTURE.COMPLETED':
                resource = body.get('resource', {})
                custom_data = json.loads(resource.get('custom', '{}'))
                
                if custom_data.get('telegram_user_id'):
                    # Credit user in background
                    cur.execute("""
                        UPDATE players 
                        SET gems = gems + %s
                        WHERE telegram_user_id = %s
                    """, (custom_data.get('gems', 100), custom_data['telegram_user_id']))
            
            conn.commit()
    finally:
        conn.close()
    
    return {"status": "received"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

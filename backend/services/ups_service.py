"""
UPS Rating API integration service.
Handles OAuth authentication and rate requests for UPS shipping.
"""
from __future__ import annotations
import requests
import base64
import json
import logging
from typing import Dict, Any, Optional
from backend.core.config import get_settings

logger = logging.getLogger(__name__)


def get_oauth_token(client_id: str, client_secret: str, use_production: bool = True) -> str:
    """
    Get OAuth token from UPS using client credentials flow.
    
    Args:
        client_id: UPS API Client ID
        client_secret: UPS API Client Secret
        use_production: If True, use production endpoint; else use CIE (testing)
    
    Returns:
        OAuth access token string
    
    Raises:
        ValueError: If authentication fails
    """
    if use_production:
        token_url = "https://onlinetools.ups.com/security/v1/oauth/token"
    else:
        token_url = "https://wwwcie.ups.com/security/v1/oauth/token"
    
    # Create Basic Auth header using client_secret_basic method
    credentials = f"{client_id}:{client_secret}"
    encoded_credentials = base64.b64encode(credentials.encode()).decode()
    
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": f"Basic {encoded_credentials}"
    }
    
    data = {
        "grant_type": "client_credentials"
    }
    
    try:
        response = requests.post(token_url, headers=headers, data=data)
        response.raise_for_status()
        token_data = response.json()
        return token_data["access_token"]
    except requests.exceptions.RequestException as e:
        raise ValueError(f"UPS OAuth authentication failed: {str(e)}")
    except KeyError:
        raise ValueError("UPS OAuth response missing access_token")


def map_service_level_to_ups_code(service_level: Optional[str], destination_country: Optional[str], origin_country: Optional[str] = None) -> tuple[str, str]:
    """
    Map OES service level to UPS service code based on destination and origin countries.
    
    Args:
        service_level: Service level from OES (e.g., "Next Day Air Early/Express Early")
        destination_country: Destination country code (e.g., "US", "CA")
        origin_country: Origin country code (e.g., "US", "CA"). Defaults to None.
                      If None, assumes US origin (for backward compatibility).
    
    Returns:
        Tuple of (service_code, service_description)
    """
    # Normalize origin country
    origin_country = (origin_country or "US").upper().strip()[:2]
    if len(origin_country) != 2:
        origin_country = "US"
    
    # Determine if origin is CA
    is_origin_ca = origin_country == "CA"
    
    # Determine if destination is US or CA
    destination_country = (destination_country or "US").upper().strip()[:2]
    if len(destination_country) != 2:
        destination_country = "US"
    
    is_us = destination_country == "US"
    is_ca = destination_country == "CA"
    
    # Determine if this is a domestic or international shipment
    # If origin is CA, all shipments (including CA-to-CA) use international codes
    # If origin is US, US-to-US is domestic, US-to-CA is international
    use_international_codes = is_origin_ca or (origin_country != destination_country)
    
    # If service level is empty or None, use defaults
    if not service_level or not service_level.strip():
        if use_international_codes:
            # Default to Standard for international (code 11)
            return ("11", "UPS Standard")
        else:
            # Default to Ground for domestic US (code 03)
            return ("03", "Ground")
    
    # Normalize service level string
    service_level_lower = service_level.lower().strip()
    
    if use_international_codes:
        # International codes (for CA origin or cross-border shipments)
        if "next day air early" in service_level_lower or "express early" in service_level_lower:
            return ("54", "UPS Worldwide Express Plus")
        elif "next day air" in service_level_lower or "express" in service_level_lower:
            return ("07", "UPS Worldwide Express")
        elif "2nd day air" in service_level_lower or "expedited" in service_level_lower:
            return ("08", "UPS Worldwide Expedited")
        elif "ground" in service_level_lower or "standard" in service_level_lower:
            return ("11", "UPS Standard")
        elif "express saver" in service_level_lower or "next day air saver" in service_level_lower:
            return ("65", "UPS Saver")
        elif "3 day select" in service_level_lower:
            return ("11", "UPS Standard")  # No 3-day international, use Standard
        else:
            # No match found, default to Standard for international
            return ("11", "UPS Standard")
    else:
        # Domestic US codes (US-to-US only)
        if "next day air early" in service_level_lower or "express early" in service_level_lower:
            return ("14", "UPS Next Day Air Early")
        elif "next day air" in service_level_lower or "express" in service_level_lower:
            return ("01", "Next Day Air")
        elif "2nd day air" in service_level_lower or "expedited" in service_level_lower:
            return ("02", "2nd Day Air")
        elif "ground" in service_level_lower or "standard" in service_level_lower:
            return ("03", "Ground")
        elif "express saver" in service_level_lower or "next day air saver" in service_level_lower:
            return ("13", "Next Day Air Saver")
        elif "3 day select" in service_level_lower:
            return ("12", "3 Day Select")
        else:
            # No match found, default to Ground for domestic
            return ("03", "Ground")


def get_ups_rate(
    pack_id: int,
    pack_boxes: list[Dict[str, Any]],
    ship_to_address: Dict[str, Any],
    service_level: Optional[str],
    ups_account_number: str,
    ship_from_address: Dict[str, Any],
    use_production: bool = True
) -> Dict[str, Any]:
    """
    Get UPS shipping rate for a pack.
    
    Args:
        pack_id: Pack ID
        pack_boxes: List of box dictionaries with dimensions and weights
        ship_to_address: Ship-to address dictionary
        service_level: Service level from OES
        ups_account_number: UPS account number (6 digits)
        ship_from_address: Ship-from address dictionary
        use_production: If True, use production endpoint; else use CIE
    
    Returns:
        UPS RateResponse dictionary
    
    Raises:
        ValueError: If request fails or missing required data
    """
    settings = get_settings()
    
    # Validate credentials
    if not settings.UPS_CLIENT_ID or not settings.UPS_CLIENT_SECRET:
        raise ValueError("UPS API credentials not configured")
    
    if not ups_account_number:
        raise ValueError("UPS account number is required for negotiated rates")
    
    # Get OAuth token
    token = get_oauth_token(settings.UPS_CLIENT_ID, settings.UPS_CLIENT_SECRET, use_production)
    
    # Map service level to UPS code
    # Extract and normalize destination country code
    destination_country = ship_to_address.get("ship_country") or ship_to_address.get("country") or "US"
    # Normalize to uppercase 2-letter code
    destination_country = destination_country.upper().strip()[:2] if destination_country else "US"
    if len(destination_country) != 2:
        destination_country = "US"  # Ensure it's exactly 2 characters
    
    # Extract origin country from ship-from address
    origin_country = ship_from_address.get("country", "CA").upper().strip()[:2]
    if len(origin_country) != 2:
        origin_country = "CA"  # Default to CA based on config
    
    service_code, service_description = map_service_level_to_ups_code(service_level, destination_country, origin_country)
    
    # Build packages array
    packages = []
    for box in pack_boxes:
        # Get dimensions from box data
        length = box.get("custom_l_in")
        width = box.get("custom_w_in")
        height = box.get("custom_h_in")
        
        # Get weight
        weight = box.get("weight_lbs") or box.get("weight_entered") or 0
        
        # Validate dimensions and weight
        if not all([length, width, height]):
            raise ValueError(f"Box {box.get('box_no', 'unknown')} missing dimensions")
        if not weight or weight <= 0:
            raise ValueError(f"Box {box.get('box_no', 'unknown')} missing or invalid weight")
        
        # Convert dimensions to float then int (type checker knows these are not None after validation)
        length_val = float(length) if length is not None else 0
        width_val = float(width) if width is not None else 0
        height_val = float(height) if height is not None else 0
        
        packages.append({
            "PackagingType": {
                "Code": "02",
                "Description": "Package"
            },
            "Dimensions": {
                "UnitOfMeasurement": {
                    "Code": "IN",
                    "Description": "Inches"
                },
                "Length": str(int(length_val)),
                "Width": str(int(width_val)),
                "Height": str(int(height_val))
            },
            "PackageWeight": {
                "UnitOfMeasurement": {
                    "Code": "LBS",
                    "Description": "Pounds"
                },
                "Weight": str(float(weight))
            }
        })
    
    if not packages:
        raise ValueError("No packages found in pack")
    
    # Build ship-to address
    ship_to_address_lines = []
    if ship_to_address.get("ship_address1"):
        ship_to_address_lines.append(ship_to_address["ship_address1"])
    if ship_to_address.get("ship_address2"):
        ship_to_address_lines.append(ship_to_address["ship_address2"])
    
    if not ship_to_address_lines:
        raise ValueError("Ship-to address line is required")
    
    ship_to_state = ship_to_address.get("ship_province") or ship_to_address.get("state_province_code") or ""
    if len(ship_to_state) > 2:
        # Extract 2-letter state code if full name provided
        ship_to_state = ship_to_state[:2].upper()
    
    # Build request payload
    payload = {
        "RateRequest": {
            "Request": {
                "TransactionReference": {
                    "CustomerContext": f"Pack {pack_id} Rate Request",
                    "TransactionIdentifier": f"pack_{pack_id}"
                }
            },
            "Shipment": {
                "Shipper": {
                    "Name": ship_from_address.get("name", "Dayus"),
                    "ShipperNumber": ups_account_number,
                    "Address": {
                        "AddressLine": [
                            line for line in [
                                ship_from_address.get("address1"),
                                ship_from_address.get("address2")
                            ] if line
                        ],
                        "City": ship_from_address.get("city", ""),
                        "StateProvinceCode": ship_from_address.get("province", "")[:2].upper(),
                        "PostalCode": ship_from_address.get("postal_code", ""),
                        "CountryCode": ship_from_address.get("country", "CA")
                    }
                },
                "ShipTo": {
                    "Name": ship_to_address.get("ship_name", "")[:35],  # Max 35 chars
                    "Address": {
                        "AddressLine": ship_to_address_lines,
                        "City": ship_to_address.get("ship_city", ""),
                        "StateProvinceCode": ship_to_state[:2].upper(),
                        "PostalCode": ship_to_address.get("ship_postal_code", "") or ship_to_address.get("ship_postal_code", ""),
                        "CountryCode": destination_country
                    }
                },
                "PaymentDetails": {
                    "ShipmentCharge": {
                        "Type": "01",
                        "BillShipper": {
                            "AccountNumber": ups_account_number
                        }
                    }
                },
                "ShipmentRatingOptions": {
                    "NegotiatedRatesIndicator": "Y"
                },
                "Service": {
                    "Code": service_code,
                    "Description": service_description
                },
                "NumOfPieces": str(len(packages)),
                "Package": packages
            }
        }
    }
    
    # Make API request
    if use_production:
        api_url = "https://onlinetools.ups.com/api/rating/v2409/Rate"
    else:
        api_url = "https://wwwcie.ups.com/api/rating/v2409/Rate"
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "transId": f"pack_{pack_id}".ljust(32)[:32],  # 32 char max
        "transactionSrc": "packaging-app"
    }
    
    # Log request payload for debugging
    logger.info(f"UPS API Request for Pack {pack_id}:")
    logger.info(f"URL: {api_url}")
    logger.info(f"Headers: {json.dumps({k: v if k != 'Authorization' else 'Bearer [REDACTED]' for k, v in headers.items()}, indent=2)}")
    logger.info(f"Payload: {json.dumps(payload, indent=2)}")
    
    try:
        response = requests.post(api_url, json=payload, headers=headers)
        
        # Log response for debugging
        logger.info(f"UPS API Response for Pack {pack_id}:")
        logger.info(f"Status Code: {response.status_code}")
        try:
            response_json = response.json()
            logger.info(f"Response Body: {json.dumps(response_json, indent=2)}")
        except:
            logger.info(f"Response Body (raw): {response.text[:1000]}")  # Limit to first 1000 chars
        
        response.raise_for_status()
        return response_json
    except requests.exceptions.RequestException as e:
        error_msg = f"UPS API request failed: {str(e)}"
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_data = e.response.json()
                logger.error(f"UPS API Error Response: {json.dumps(error_data, indent=2)}")
                error_msg += f" - {error_data}"
            except:
                logger.error(f"UPS API Error Response (raw): {e.response.text[:1000]}")
                error_msg += f" - Status: {e.response.status_code}"
        raise ValueError(error_msg)


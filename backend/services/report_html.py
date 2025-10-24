"""
HTML-based packing slip PDF generator using Playwright.
Uses Jinja2 for templating and Playwright for PDF generation with proper image support.
"""

import os
import tempfile
import base64
from datetime import datetime
from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.sync_api import sync_playwright
from typing import Dict, List


def load_assets_as_base64() -> Dict[str, str]:
    """
    Load all required assets (images and fonts) as base64 data URIs.
    
    Returns:
        Dict[str, str]: Dictionary with asset names as keys and base64 data URIs as values
    """
    # Get the project root directory
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    assets_dir = os.path.join(project_root, "Frontend", "vite-project", "src", "assets")
    
    assets = {}
    
    # List of required assets
    asset_files = [
        "dayus-logo.svg",
        "Square - 3 Day - New Red.png",
        "Rectangle - 3 Day - New Red.png",
        "Rectangle - Friday - New Red .png",
        "Rectangle - Standard - New Red.png",
        "footer.png",
        "dayus-mark.png",
        "code128.ttf"
    ]
    
    for asset_file in asset_files:
        asset_path = os.path.join(assets_dir, asset_file)
        
        if os.path.exists(asset_path):
            try:
                with open(asset_path, 'rb') as f:
                    file_data = f.read()
                    base64_data = base64.b64encode(file_data).decode('utf-8')
                    
                    # Determine MIME type based on file extension
                    if asset_file.endswith('.svg'):
                        mime_type = 'image/svg+xml'
                    elif asset_file.endswith('.png'):
                        mime_type = 'image/png'
                    elif asset_file.endswith('.ttf'):
                        mime_type = 'font/ttf'
                    else:
                        mime_type = 'application/octet-stream'
                    
                    # Create data URI
                    data_uri = f"data:{mime_type};base64,{base64_data}"
                    assets[asset_file] = data_uri
                    
            except Exception as e:
                print(f"Warning: Could not load asset {asset_file}: {e}")
                assets[asset_file] = ""
        else:
            print(f"Warning: Asset file not found: {asset_path}")
            assets[asset_file] = ""
    
    return assets


def group_items_for_display(items: List[Dict]) -> List[Dict]:
    """
    Group identical items and format box numbers for display.
    
    Logic:
    - Items with same product_code, dimensions, finish, qty_ordered, qty_shipped, and product_tag are grouped
    - Box numbers are displayed as:
      * Single box: "5"
      * Consecutive boxes: "5-9"
      * Non-consecutive boxes: "5, 7, 9"
    """
    from collections import defaultdict
    
    # Group items by unique key
    groups = {}
    
    for item in items:
        # Create grouping key
        key = (
            item.get('product_code', ''),
            str(item.get('length_in', '')),
            str(item.get('height_in', '')),
            item.get('finish', ''),
            str(item.get('qty_ordered', '')),
            str(item.get('qty_shipped', '')),
            item.get('product_tag', '')
        )
        
        # Initialize group if not exists
        if key not in groups:
            groups[key] = {
                'boxes': [],
                'qty_ordered': 0,
                'qty_shipped': 0,
                'product_code': '',
                'length_in': '',
                'height_in': '',
                'finish': '',
                'product_tag': ''
            }
        
        # Add box number
        box_no = item.get('box_no')
        if box_no is not None:
            groups[key]['boxes'].append(box_no)
        
        # Accumulate quantities and set attributes
        groups[key]['qty_ordered'] = item.get('qty_ordered', 0)
        groups[key]['qty_shipped'] += item.get('qty_shipped', 0)
        groups[key]['product_code'] = item.get('product_code', '')
        groups[key]['length_in'] = item.get('length_in', '')
        groups[key]['height_in'] = item.get('height_in', '')
        groups[key]['finish'] = item.get('finish', '')
        groups[key]['product_tag'] = item.get('product_tag', '')
    
    # Format box numbers for display
    result = []
    for group_data in groups.values():
        boxes = sorted(group_data['boxes'])
        
        if len(boxes) == 0:
            box_display = ""
        elif len(boxes) == 1:
            box_display = str(boxes[0])
        else:
            # Check if consecutive
            is_consecutive = all(
                boxes[i + 1] - boxes[i] == 1 
                for i in range(len(boxes) - 1)
            )
            
            if is_consecutive:
                box_display = f"{boxes[0]}-{boxes[-1]}"
            else:
                box_display = ", ".join(str(b) for b in boxes)
        
        result.append({
            'box_display': box_display,
            'qty_ordered': group_data['qty_ordered'],
            'qty_shipped': group_data['qty_shipped'],
            'product_code': group_data['product_code'],
            'length_in': group_data['length_in'],
            'height_in': group_data['height_in'],
            'finish': group_data['finish'],
            'product_tag': group_data['product_tag']
        })
    
    return result


def generate_packing_slip_pdf(data: Dict, pack_id: int) -> str:
    """
    Generate a packing slip PDF from HTML template using Playwright.
    
    Args:
        data: Packing slip data dictionary from get_packing_slip_data()
        pack_id: Pack ID for filename
        
    Returns:
        str: Path to generated PDF file
    """
    # Setup Jinja2 environment
    templates_dir = os.path.join(
        os.path.dirname(__file__), 
        "..", 
        "templates"
    )
    
    env = Environment(
        loader=FileSystemLoader(templates_dir),
        autoescape=select_autoescape(['html', 'xml'])
    )
    
    # Load template
    template = env.get_template('packing_slip.html')
    
    # Group items for display
    grouped_items = group_items_for_display(data.get('items', []))
    
    # Load assets as base64
    assets = load_assets_as_base64()
    
    # Calculate total pages (simple calculation - 1 page for now, can be enhanced)
    total_pages = 1
    current_page = 1
    
    # Prepare template data
    template_data = {
        **data,  # Include all original data
        'grouped_items': grouped_items,
        'current_page': current_page,
        'total_pages': total_pages,
        'assets': assets,  # Include base64 assets
    }
    
    # Render HTML
    html_content = template.render(**template_data)
    
    # Generate PDF using Playwright
    temp_dir = tempfile.gettempdir()
    pdf_path = os.path.join(temp_dir, f"packing_slip_{pack_id}.pdf")
    
    print(f"Generating PDF at: {pdf_path}")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # Set content and wait for images to load
        page.set_content(html_content, wait_until='networkidle')
        
        # Generate PDF with proper settings for Letter size
        page.pdf(
            path=pdf_path,
            format='Letter',
            print_background=True,
            margin={
                'top': '0.5in',
                'right': '0.5in',
                'bottom': '0.75in',
                'left': '0.5in'
            },
            display_header_footer=False,  # We're using our custom footer
            prefer_css_page_size=True,
            width='8.5in',
            height='11in'
        )
        
        browser.close()
    
    print(f"PDF generated successfully: {pdf_path}")
    return pdf_path
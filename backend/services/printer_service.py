import os
import subprocess
import tempfile
import re
from typing import Optional
from pathlib import Path
import platform

def get_system_printers() -> list[dict]:
    """
    Get list of available printers on the system.
    Returns a list of printer dictionaries with name and id.
    """
    printers = []
    
    try:
        if platform.system() == "Windows":
            # Windows: Use pywin32 to get actual printer list
            try:
                import win32print
                
                # Get all printers (local and network)
                printer_list = win32print.EnumPrinters(
                    win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
                )
                
                for printer_info in printer_list:
                    # printer_info is a tuple: (server_name, printer_name, share_name, description)
                    printer_name = printer_info[1]
                    
                    # Clean up printer name - remove extra info after commas
                    if ',' in printer_name:
                        printer_name = printer_name.split(',')[0].strip()
                    
                    # Generate clean ID
                    printer_id = printer_name.lower().replace(' ', '_').replace('-', '_').replace('(', '').replace(')', '').replace('.', '').replace('/', '_')
                    
                    printers.append({
                        "name": printer_name,
                        "id": printer_id
                    })
                    
            except ImportError:
                # Fallback to PowerShell if pywin32 not available
                powershell_script = """
                Get-Printer | ForEach-Object {
                    $printer = $_
                    $printerName = $printer.Name
                    # Remove extra info after commas
                    if ($printerName -match ',') {
                        $printerName = $printerName -split ',' | Select-Object -First 1
                    }
                    $printerId = $printerName.ToLower() -replace '[^a-z0-9]', '_'
                    Write-Output "$printerName|$printerId"
                }
                """
                
                result = subprocess.run([
                    "powershell", "-Command", powershell_script
                ], capture_output=True, text=True, check=True)
                
                for line in result.stdout.strip().split('\n'):
                    if line.strip() and '|' in line:
                        printer_name, printer_id = line.strip().split('|', 1)
                        printers.append({
                            "name": printer_name,
                            "id": printer_id
                        })
        
        elif platform.system() == "Darwin":  # macOS
            # macOS: Use lpstat to get printer list
            result = subprocess.run(
                ["lpstat", "-p"],
                capture_output=True,
                text=True,
                check=True
            )
            
            for line in result.stdout.split('\n'):
                if line.startswith('printer '):
                    printer_name = line.split()[1]
                    printers.append({
                        "name": printer_name,
                        "id": printer_name.lower().replace(' ', '_')
                    })
        
        else:  # Linux
            # Linux: Use lpstat to get printer list
            result = subprocess.run(
                ["lpstat", "-p"],
                capture_output=True,
                text=True,
                check=True
            )
            
            for line in result.stdout.split('\n'):
                if line.startswith('printer '):
                    printer_name = line.split()[1]
                    printers.append({
                        "name": printer_name,
                        "id": printer_name.lower().replace(' ', '_')
                    })
    
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Fallback to mock printers if system commands fail
        printers = [
            {"name": "Default Printer", "id": "default"},
            {"name": "HP LaserJet Pro", "id": "hp_laserjet"},
            {"name": "Canon PIXMA", "id": "canon_pixma"},
            {"name": "Brother MFC-L2750DW", "id": "brother_mfc"},
            {"name": "Zebra ZD420", "id": "zebra_zd420"},
            {"name": "DYMO LabelWriter 450", "id": "dymo_450"},
        ]
    
    return printers


def print_html_to_printer(html_content: str, printer_name: str) -> bool:
    """
    Print HTML content directly to the specified printer.
    
    Args:
        html_content: HTML content as string
        printer_name: Name of the printer
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        if platform.system() == "Windows":
            # Windows: Save HTML and open in default browser with print dialog
            with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as temp_file:
                # Add JavaScript to auto-print and close
                auto_print_html = html_content.replace(
                    '</body>', 
                    '''
                    <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() {
                            window.close();
                        }, 1000);
                    };
                    </script>
                    </body>
                    '''
                )
                temp_file.write(auto_print_html)
                temp_html_path = temp_file.name
            
            # Open HTML file in default browser
            subprocess.run([
                "start", temp_html_path
            ], check=True, shell=True)
            
            # Clean up after a delay
            import threading
            def cleanup():
                import time
                time.sleep(5)  # Wait 5 seconds before cleanup
                try:
                    os.unlink(temp_html_path)
                except OSError:
                    pass
            
            threading.Thread(target=cleanup, daemon=True).start()
            
        elif platform.system() == "Darwin":  # macOS
            # macOS: Use open command to print HTML
            with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as temp_file:
                temp_file.write(html_content)
                temp_html_path = temp_file.name
            
            # Use open command to print HTML
            subprocess.run([
                "open", "-a", "Safari", temp_html_path
            ], check=True)
            
            # Clean up
            try:
                os.unlink(temp_html_path)
            except OSError:
                pass
            
        else:  # Linux
            # Linux: Use html2ps and lpr
            with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as temp_file:
                temp_file.write(html_content)
                temp_html_path = temp_file.name
            
            # Convert HTML to PostScript and print
            subprocess.run([
                "html2ps", temp_html_path, "|", "lpr", "-P", printer_name
            ], check=True, shell=True)
            
            # Clean up
            try:
                os.unlink(temp_html_path)
            except OSError:
                pass
        
        return True
    
    except subprocess.CalledProcessError as e:
        print(f"Failed to print HTML to {printer_name}: {e}")
        return False
    except Exception as e:
        print(f"Unexpected error printing HTML to {printer_name}: {e}")
        return False


def generate_multi_page_label_html(all_box_data: list[dict]) -> str:
    """
    Generate a multi-page HTML document with all box labels.
    Each label is on a separate page for printing.
    
    Args:
        all_box_data: List of dictionaries containing box label data
        
    Returns:
        str: Complete HTML document with all labels
    """
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    import os
    
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
    
    # Add custom filters
    def format_dimension(value):
        if value is None:
            return ''
        try:
            num = float(value)
            formatted = f"{num:.3f}".rstrip('0').rstrip('.')
            return formatted
        except (ValueError, TypeError):
            return str(value)
    
    def format_phone(value):
        if not value:
            return ''
        digits = ''.join(filter(str.isdigit, str(value)))
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        elif len(digits) == 11 and digits[0] == '1':
            return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
        return str(value)
    
    env.filters['format_dim'] = format_dimension
    env.filters['format_phone'] = format_phone
    
    # Load the box label template
    template = env.get_template('box_label.html')
    
    # Generate HTML for each box label and extract styles
    label_body_parts = []
    all_styles = set()
    
    for box_data in all_box_data:
        label_html = template.render(**box_data)
        
        # Extract styles from the HTML (from <style> tags)
        style_pattern = r'<style[^>]*>(.*?)</style>'
        for match in re.finditer(style_pattern, label_html, re.DOTALL):
            all_styles.add(match.group(1))
        
        # Extract body content
        body_start = label_html.find('<body')
        if body_start != -1:
            body_end = label_html.find('</body>') + 7
            body_tag = label_html[body_start:body_end]
            # Extract content between <body> and </body>
            body_content_start = body_tag.find('>') + 1
            body_content_end = body_tag.rfind('</body>')
            body_content = body_tag[body_content_start:body_content_end].strip()
            label_body_parts.append(body_content)
    
    # Combine all labels into one multi-page HTML document
    # Use CSS page breaks to separate each label onto its own page
    combined_styles = '\n'.join(all_styles)
    
    multi_page_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Box Labels - All Labels</title>
    <style>
        @page {{
            size: 4in 4.75in;
            margin: 0;
        }}
        
        {combined_styles}
        
        .label-page {{
            width: 4in;
            height: 4.75in;
            page-break-after: always;
            page-break-inside: avoid;
            box-sizing: border-box;
            position: relative;
        }}
        
        .label-page:last-child {{
            page-break-after: auto;
        }}
    </style>
</head>
<body>
"""
    
    # Add each label wrapped in a page break div
    for body_content in label_body_parts:
        multi_page_html += f'    <div class="label-page">{body_content}</div>\n'
    
    multi_page_html += """</body>
</html>"""
    
    return multi_page_html


def print_box_label_direct(html_content: str, printer_name: str) -> bool:
    """
    Print a box label directly to the specified printer using HTML.
    
    Args:
        html_content: HTML content of the box label
        printer_name: Name of the printer to print to
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Print HTML directly to printer
        return print_html_to_printer(html_content, printer_name)
    
    except Exception as e:
        print(f"Error in print_box_label_direct: {e}")
        return False


def print_box_label_from_template(template_data: dict, printer_name: str) -> bool:
    """
    Print a box label using template data.
    
    Args:
        template_data: Dictionary containing box label data
        printer_name: Name of the printer to print to
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        import os
        
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
        
        # Add custom filters
        def format_dimension(value):
            if value is None:
                return ''
            try:
                num = float(value)
                formatted = f"{num:.3f}".rstrip('0').rstrip('.')
                return formatted
            except (ValueError, TypeError):
                return str(value)
        
        def format_phone(value):
            if not value:
                return ''
            digits = ''.join(filter(str.isdigit, str(value)))
            if len(digits) == 10:
                return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
            elif len(digits) == 11 and digits[0] == '1':
                return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
            return str(value)
        
        env.filters['format_dim'] = format_dimension
        env.filters['format_phone'] = format_phone
        
        # Load and render template
        template = env.get_template('box_label.html')
        html_content = template.render(**template_data)
        
        # Print directly
        return print_box_label_direct(html_content, printer_name)
    
    except Exception as e:
        print(f"Error in print_box_label_from_template: {e}")
        return False

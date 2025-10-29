import React, { useState, useEffect } from 'react';
import { Card, Select, Button, message, Divider, Typography, Space } from 'antd';
import { PrinterOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Option } = Select;

function Settings() {
  const [boxLabelPrinter, setBoxLabelPrinter] = useState('');
  const [packingSlipPrinter, setPackingSlipPrinter] = useState('');
  const [availablePrinters, setAvailablePrinters] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load printer settings on component mount
  useEffect(() => {
    loadPrinterSettings();
    detectPrinters();
  }, []);

  const loadPrinterSettings = () => {
    try {
      const savedBoxLabelPrinter = localStorage.getItem('boxLabelPrinter') || '';
      const savedPackingSlipPrinter = localStorage.getItem('packingSlipPrinter') || '';
      
      setBoxLabelPrinter(savedBoxLabelPrinter);
      setPackingSlipPrinter(savedPackingSlipPrinter);
    } catch (error) {
      console.error('Error loading printer settings:', error);
    }
  };

  const detectPrinters = async () => {
    try {
      setLoading(true);
      // Fetch real printers from backend
      const response = await fetch('http://localhost:8000/api/pack/system/printers');
      if (response.ok) {
        const printers = await response.json();
        setAvailablePrinters(printers);
      } else {
        // Fallback to mock printers if API fails
        const mockPrinters = [
          { name: 'Default Printer', id: 'default' },
          { name: 'HP LaserJet Pro', id: 'hp_laserjet' },
          { name: 'Canon PIXMA', id: 'canon_pixma' },
          { name: 'Brother MFC-L2750DW', id: 'brother_mfc' },
          { name: 'Zebra ZD420', id: 'zebra_zd420' },
          { name: 'DYMO LabelWriter 450', id: 'dymo_450' },
        ];
        setAvailablePrinters(mockPrinters);
      }
    } catch (error) {
      console.error('Error detecting printers:', error);
      // Fallback to mock printers
      const mockPrinters = [
        { name: 'Default Printer', id: 'default' },
        { name: 'HP LaserJet Pro', id: 'hp_laserjet' },
        { name: 'Canon PIXMA', id: 'canon_pixma' },
        { name: 'Brother MFC-L2750DW', id: 'brother_mfc' },
        { name: 'Zebra ZD420', id: 'zebra_zd420' },
        { name: 'DYMO LabelWriter 450', id: 'dymo_450' },
      ];
      setAvailablePrinters(mockPrinters);
      message.error('Failed to detect printers, using default list');
    } finally {
      setLoading(false);
    }
  };

  const savePrinterSettings = async () => {
    setLoading(true);
    try {
      // Save to localStorage for now
      localStorage.setItem('boxLabelPrinter', boxLabelPrinter);
      localStorage.setItem('packingSlipPrinter', packingSlipPrinter);
      
      message.success('Printer settings saved successfully!');
    } catch (error) {
      console.error('Error saving printer settings:', error);
      message.error('Failed to save printer settings');
    } finally {
      setLoading(false);
    }
  };

  const resetToDefaults = () => {
    setBoxLabelPrinter('');
    setPackingSlipPrinter('');
    message.info('Settings reset to defaults');
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <Title level={2}>
        <PrinterOutlined style={{ marginRight: '8px' }} />
        Settings
      </Title>
      
      <Card title="Printer Settings" style={{ marginBottom: '24px' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Text strong>Box Label Printer</Text>
            <br />
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Select the printer for printing box labels
            </Text>
            <Select
              style={{ width: '100%', marginTop: '8px' }}
              placeholder="Select box label printer"
              value={boxLabelPrinter}
              onChange={setBoxLabelPrinter}
            >
              {availablePrinters.map(printer => (
                <Option key={printer.id} value={printer.id}>
                  {printer.name}
                </Option>
              ))}
            </Select>
          </div>

          <Divider />

          <div>
            <Text strong>Packing Slip Printer</Text>
            <br />
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Select the printer for printing packing slips
            </Text>
            <Select
              style={{ width: '100%', marginTop: '8px' }}
              placeholder="Select packing slip printer"
              value={packingSlipPrinter}
              onChange={setPackingSlipPrinter}
            >
              {availablePrinters.map(printer => (
                <Option key={printer.id} value={printer.id}>
                  {printer.name}
                </Option>
              ))}
            </Select>
          </div>

          <Divider />

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Button onClick={resetToDefaults}>
              Reset to Defaults
            </Button>
            <Button 
              icon={<ReloadOutlined />}
              onClick={detectPrinters}
              loading={loading}
            >
              Refresh Printers
            </Button>
            <Button 
              type="primary" 
              icon={<SaveOutlined />}
              onClick={savePrinterSettings}
              loading={loading}
            >
              Save Settings
            </Button>
          </div>
        </Space>
      </Card>

      <Card title="Current Settings" size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>Box Label Printer: </Text>
            <Text>{boxLabelPrinter ? availablePrinters.find(p => p.id === boxLabelPrinter)?.name || 'Unknown' : 'Not set'}</Text>
          </div>
          <div>
            <Text strong>Packing Slip Printer: </Text>
            <Text>{packingSlipPrinter ? availablePrinters.find(p => p.id === packingSlipPrinter)?.name || 'Unknown' : 'Not set'}</Text>
          </div>
        </Space>
      </Card>
    </div>
  );
}

export default Settings;

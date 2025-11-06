import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  DatePicker,
  Input,
  Space,
  message,
  Typography,
  Tooltip,
  Tag,
  Spin,
  Modal,
  Dropdown,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  EditOutlined,
  PrinterOutlined,
  MoreOutlined,
  InboxOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isSupervisor } from '../utils/roles';
import { getCompletedPacks, reopenPack, downloadPackingSlip, getUPSRate } from '../api/packs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

function Packs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState(dayjs()); // Default to today on page load
  const [searchInput, setSearchInput] = useState('');

  // Check if user is supervisor
  if (!isSupervisor(user?.role)) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Title level={3} type="danger">Access Denied</Title>
          <Text type="secondary">This page is only available to supervisors.</Text>
        </div>
      </Card>
    );
  }

  // Load completed packs
  const loadPacks = useCallback(async () => {
    try {
      setLoading(true);
      // Now using date filtering since completed_at is populated
      const date = selectedDate ? selectedDate.format('YYYY-MM-DD') : null;
      const search = searchTerm.trim() || null;
      const data = await getCompletedPacks(date, search);
      setPacks(data);
    } catch (error) {
      message.error(error.message || 'Failed to load completed packs');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, selectedDate]);

  // Load packs on mount and when filters change
  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [reopenModal, setReopenModal] = useState({ visible: false, packId: null, orderNo: null });
  const [upsRateModal, setUpsRateModal] = useState({ visible: false, packId: null, loading: false, rateData: null, error: null });

  const handleModifyPack = async (packId, orderNo) => {
    setReopenModal({ visible: true, packId, orderNo });
  };

  const handleConfirmReopen = async () => {
    const { packId, orderNo } = reopenModal;
    try {
      await reopenPack(packId);
      message.success(`Pack reopened successfully. Redirecting to Orders page for order ${orderNo}...`);
      // Close modal first
      setReopenModal({ visible: false, packId: null, orderNo: null });
      // Navigate to Orders page with the order number
      navigate(`/orders?order=${orderNo}`);
    } catch (error) {
      message.error(error.message || 'Failed to reopen pack');
    }
  };

  const handleCancelReopen = () => {
    setReopenModal({ visible: false, packId: null, orderNo: null });
  };

  const handlePrintPackingSlip = async (packId) => {
    try {
      await downloadPackingSlip(packId);
      message.success('Packing slip download started');
    } catch (error) {
      message.error(error.message || 'Failed to download packing slip');
    }
  };

  const handleGetUPSRate = async (packId) => {
    setUpsRateModal({ visible: true, packId, loading: true, rateData: null, error: null });
    try {
      const rateData = await getUPSRate(packId);
      setUpsRateModal({ visible: true, packId, loading: false, rateData, error: null });
    } catch (error) {
      setUpsRateModal({ visible: true, packId, loading: false, rateData: null, error: error.message });
      message.error(error.message || 'Failed to get UPS rate');
    }
  };

  const handleCloseUPSRateModal = () => {
    setUpsRateModal({ visible: false, packId: null, loading: false, rateData: null, error: null });
  };

  const columns = [
    {
      title: 'Order No',
      dataIndex: 'order_no',
      key: 'order_no',
      sorter: (a, b) => a.order_no.localeCompare(b.order_no),
      render: (text) => (
        <Text strong style={{ color: '#1677ff' }}>{text}</Text>
      ),
    },
    {
      title: 'Customer',
      dataIndex: 'customer_name',
      key: 'customer_name',
      sorter: (a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''),
      render: (text) => text || <Text type="secondary">-</Text>,
    },
    {
      title: 'Ship To',
      key: 'ship_to',
      render: (_, record) => {
        const city = record.ship_city || '';
        const province = record.ship_province || '';
        const shipTo = [city, province].filter(Boolean).join(', ');
        return shipTo || <Text type="secondary">-</Text>;
      },
    },
    {
      title: 'Packager',
      dataIndex: 'packager_username',
      key: 'packager_username',
      render: (text) => (
        <Tag color="blue">{text || 'Unknown'}</Tag>
      ),
    },
    {
      title: 'Completed Date',
      dataIndex: 'completed_at',
      key: 'completed_at',
      sorter: (a, b) => {
        if (!a.completed_at && !b.completed_at) return 0;
        if (!a.completed_at) return 1;
        if (!b.completed_at) return -1;
        return new Date(a.completed_at) - new Date(b.completed_at);
      },
      render: (text) => {
        if (!text) return <Text type="secondary">-</Text>;
        return <Text>{dayjs(text).format('YYYY-MM-DD HH:mm')}</Text>;
      },
    },
    {
      title: 'Ship By',
      dataIndex: 'ship_by',
      key: 'ship_by',
      render: (text) => text || <Text type="secondary">-</Text>,
    },
    {
      title: 'Service Level',
      dataIndex: 'service_level',
      key: 'service_level',
      render: (text) => text ? <Tag color="purple">{text}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: 'Total Boxes',
      dataIndex: 'total_boxes',
      key: 'total_boxes',
      sorter: (a, b) => a.total_boxes - b.total_boxes,
      align: 'center',
      render: (value) => (
        <Tag color="green">{value}</Tag>
      ),
    },
    {
      title: 'Total Weight',
      dataIndex: 'total_weight',
      key: 'total_weight',
      sorter: (a, b) => (a.total_weight || 0) - (b.total_weight || 0),
      align: 'center',
      render: (value) => value ? `${value} lb` : <Text type="secondary">-</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Reopen Pack for Modification">
            <Button
              type="primary"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleModifyPack(record.pack_id, record.order_no)}
              style={{
                background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                borderColor: '#1677ff',
              }}
            >
              Reopen
            </Button>
          </Tooltip>
          
          <Tooltip title="Print Packing Slip">
            <Button
              size="small"
              icon={<PrinterOutlined />}
              onClick={() => handlePrintPackingSlip(record.pack_id)}
              style={{
                background: 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
                borderColor: '#52c41a',
                color: 'white',
              }}
            >
              Print
            </Button>
          </Tooltip>
          
          {record.ship_by === 'UPS' && (
            <Tooltip title="Get UPS Rate">
              <Button
                size="small"
                icon={<InboxOutlined />}
                onClick={() => handleGetUPSRate(record.pack_id)}
                style={{
                  background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)',
                  borderColor: '#ff6b35',
                  color: 'white',
                }}
              >
                UPS Rate
              </Button>
            </Tooltip>
          )}
          
          <Dropdown
            menu={{
              items: [
                {
                  key: 'more',
                  label: 'More Actions',
                  disabled: true,
                },
              ],
            }}
            trigger={['click']}
          >
            <Button
              size="small"
              icon={<MoreOutlined />}
              disabled
            />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <InboxOutlined style={{ color: '#1677ff', fontSize: '20px' }} />
            <Title level={3} style={{ margin: 0 }}>
              Completed Packs
            </Title>
            <Text type="secondary" style={{ fontSize: '14px' }}>
              View and manage completed packing orders
            </Text>
          </div>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={loadPacks}
            loading={loading}
          >
            Refresh
          </Button>
        }
        style={{
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          border: '1px solid #f0f0f0',
        }}
        headStyle={{
          background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
          borderBottom: '2px solid #e6f7ff',
          borderRadius: '12px 12px 0 0',
        }}
      >
        {/* Filters */}
        <div style={{ 
          marginBottom: '24px', 
          padding: '16px',
          background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
          borderRadius: '8px',
          border: '1px solid #e6f7ff'
        }}>
          <Space size="large" wrap>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Text strong style={{ display: 'block', marginBottom: '4px' }}>
                <CalendarOutlined style={{ marginRight: '4px' }} />
                Completion Date
              </Text>
              <DatePicker
                value={selectedDate}
                onChange={setSelectedDate}
                format="YYYY-MM-DD"
                placeholder="Select completion date"
                style={{ width: 200 }}
                allowClear
              />
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px', minHeight: '16px' }}>
                {selectedDate ? `Showing packs from ${selectedDate.format('MMMM D, YYYY')}` : 'Showing all completed packs'}
              </Text>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Text strong style={{ display: 'block', marginBottom: '4px' }}>
                <SearchOutlined style={{ marginRight: '4px' }} />
                Search Orders
              </Text>
              <Input
                placeholder="Search by order number or customer name"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: 300 }}
                prefix={<SearchOutlined style={{ color: '#1677ff' }} />}
              />
              {/* Invisible spacer to align with DatePicker helper text */}
              <div style={{ fontSize: '12px', marginTop: '4px', minHeight: '16px' }}></div>
            </div>
          </Space>
        </div>

        {/* Results Summary */}
        <div style={{ 
          marginBottom: '16px',
          padding: '8px 12px',
          background: '#e6f7ff',
          borderRadius: '6px',
          border: '1px solid #91d5ff'
        }}>
          <Text strong style={{ color: '#1677ff' }}>
            Showing {packs.length} completed pack{packs.length !== 1 ? 's' : ''} 
            {selectedDate && ` for ${selectedDate.format('MMMM D, YYYY')}`}
            {searchTerm && ` matching "${searchTerm}"`}
          </Text>
        </div>

        {/* Table */}
        <Table
          columns={columns}
          dataSource={packs}
          rowKey="pack_id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              `${range[0]}-${range[1]} of ${total} packs`,
          }}
          style={{
            borderRadius: '8px',
          }}
          scroll={{ x: 1000 }}
        />

        {/* Reopen Confirmation Modal */}
        <Modal
          title="Reopen Pack for Modification"
          open={reopenModal.visible}
          onOk={handleConfirmReopen}
          onCancel={handleCancelReopen}
          okText="Yes, Reopen"
          cancelText="Cancel"
          okType="primary"
        >
          <p>
            Are you sure you want to reopen pack for order <strong>{reopenModal.orderNo}</strong>?
          </p>
          <p>
            This will change the pack status from 'complete' back to 'in progress' and make it available for modification.
          </p>
        </Modal>

        {/* UPS Rate Modal */}
        <Modal
          title="UPS Shipping Rate"
          open={upsRateModal.visible}
          onCancel={handleCloseUPSRateModal}
          footer={[
            <Button key="close" onClick={handleCloseUPSRateModal}>
              Close
            </Button>
          ]}
          width={800}
        >
          {upsRateModal.loading && (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin size="large" />
              <p style={{ marginTop: '16px' }}>Fetching UPS rate...</p>
            </div>
          )}
          
          {upsRateModal.error && (
            <div style={{ padding: '20px' }}>
              <Text type="danger">{upsRateModal.error}</Text>
            </div>
          )}
          
          {upsRateModal.rateData && !upsRateModal.loading && !upsRateModal.error && (
            <div>
              {upsRateModal.rateData.RateResponse?.RatedShipment ? (
                (Array.isArray(upsRateModal.rateData.RateResponse.RatedShipment) 
                  ? upsRateModal.rateData.RateResponse.RatedShipment 
                  : [upsRateModal.rateData.RateResponse.RatedShipment]
                ).map((shipment, idx) => {
                  const service = shipment.Service || {};
                  const totalCharges = shipment.NegotiatedRateCharges?.TotalCharge || shipment.TotalCharges || {};
                  const transportationCharges = shipment.NegotiatedRateCharges?.TotalCharge || shipment.TransportationCharges || {};
                  const serviceOptionsCharges = shipment.ServiceOptionsCharges || {};
                  const billingWeight = shipment.BillingWeight || {};
                  
                  return (
                    <div key={idx} style={{ marginBottom: '24px' }}>
                      <Card 
                        title={
                          <div>
                            <Text strong style={{ fontSize: '16px' }}>
                              {service.Description || `Service ${service.Code || ''}`}
                            </Text>
                            {service.Code && (
                              <Text type="secondary" style={{ marginLeft: '8px', fontSize: '14px' }}>
                                (Code: {service.Code})
                              </Text>
                            )}
                          </div>
                        }
                        style={{ marginBottom: '16px' }}
                      >
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                          <div>
                            <Text strong>Total Charges: </Text>
                            <Text style={{ fontSize: '18px', color: '#1677ff', fontWeight: 'bold' }}>
                              {totalCharges.CurrencyCode || 'USD'} {totalCharges.MonetaryValue || '0.00'}
                            </Text>
                          </div>
                          
                          <div>
                            <Text strong>Transportation Charges: </Text>
                            <Text>
                              {transportationCharges.CurrencyCode || 'USD'} {transportationCharges.MonetaryValue || '0.00'}
                            </Text>
                          </div>
                          
                          {serviceOptionsCharges.MonetaryValue && parseFloat(serviceOptionsCharges.MonetaryValue) > 0 && (
                            <div>
                              <Text strong>Service Options Charges: </Text>
                              <Text>
                                {serviceOptionsCharges.CurrencyCode || 'USD'} {serviceOptionsCharges.MonetaryValue}
                              </Text>
                            </div>
                          )}
                          
                          {billingWeight.Weight && (
                            <div>
                              <Text strong>Billing Weight: </Text>
                              <Text>
                                {billingWeight.Weight} {billingWeight.UnitOfMeasurement?.Code || 'LBS'}
                              </Text>
                            </div>
                          )}
                          
                          {shipment.NegotiatedRateCharges && (
                            <div style={{ marginTop: '8px', padding: '8px', background: '#f0f8ff', borderRadius: '4px' }}>
                              <Text type="secondary" style={{ fontSize: '12px' }}>
                                ✓ Negotiated rates applied
                              </Text>
                            </div>
                          )}
                        </Space>
                      </Card>
                    </div>
                  );
                })
              ) : (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  <Text type="secondary">No rate information available in response</Text>
                </div>
              )}
            </div>
          )}
        </Modal>
      </Card>
    </div>
  );
}

export default Packs;
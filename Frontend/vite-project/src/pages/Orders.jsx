// src/pages/Orders.jsx — use Ant Design Collapse for Boxes
import { useState, useEffect, useCallback } from "react";
import {
  Input,
  Button,
  Card,
  Table,
  message,
  Spin,
  Space,
  Modal,
  Form,
  InputNumber,
  Radio,
  Select,
  Collapse,
  Tooltip,
  Popover,
} from "antd";
import {
  DeleteOutlined,
  MinusCircleOutlined,
  DownloadOutlined,
  CopyOutlined,
} from "@ant-design/icons";

import { motion, AnimatePresence } from "framer-motion";
import { getOesOrder } from "../api/orders";
import {
  startPack,
  getPackSnapshot,
  createBox,
  completePack,
  assignOne,
  setBoxWeight,
  deleteBox,
  removeItemFromBox,
  downloadPackingSlip,
  duplicateBox,
} from "../api/packs";
import { listCartonTypes } from "../api/cartons";

// Import lead time logos
import threeDayLogo from "../assets/Rectangle - 3 Day - New Red.png";
import fridayNextLogo from "../assets/Rectangle - Friday - New Red .png";
import standardLogo from "../assets/Rectangle - Standard - New Red.png";

// Helper function to format dimensions with max 3 decimal places
function formatDimension(value) {
  if (value === null || value === undefined) return value;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  
  // Format to 3 decimal places
  const formatted = num.toFixed(3);
  
  // If decimal part is .000, return without decimal point
  if (formatted.endsWith('.000')) {
    return Math.floor(num).toString();
  }
  
  return formatted;
}

// Helper function to get lead time logo
function getLeadTimeLogo(leadTimePlan) {
  if (!leadTimePlan) return null;
  
  const plan = leadTimePlan.toLowerCase().trim();
  
  if (plan.includes('3 day') || plan.includes('3-day')) {
    return threeDayLogo;
  } else if (plan.includes('friday') && plan.includes('next')) {
    return fridayNextLogo;
  } else if (plan.includes('standard')) {
    return standardLogo;
  }
  
  return null;
}

function AddBoxModal({ visible, onClose, packId, onBoxAdded }) {
  const [form] = Form.useForm();
  const [mode, setMode] = useState("custom");
  const [cartons, setCartons] = useState([]);

  useEffect(() => {
    if (visible && mode === "predefined") {
      listCartonTypes()
        .then(setCartons)
        .catch(() => message.error("Failed to load carton list"));
    }
  }, [visible, mode]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const body =
        mode === "custom"
          ? {
              length_in: values.length_in,
              width_in: values.width_in,
              height_in: values.height_in,
            }
          : { carton_type_id: values.carton_type_id };

      const res = await createBox(packId, body);
      
      // Set weight if provided
      if (values.weight) {
        await setBoxWeight(packId, res.id, values.weight);
      }
      
      message.success("Box created");
      await onBoxAdded(res.id);
      form.resetFields();
      setMode("custom");
      onClose();
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || "Failed to create box";
      message.error(msg);
    }
  };

  return (
    <Modal
      title="Add New Box"
      open={visible}
      onOk={handleOk}
      onCancel={onClose}
      okText="Add Box"
      cancelText="Cancel"
      destroyOnClose
      footer={[
        <Button key="add" type="primary" onClick={handleOk}>
          Add Box
        </Button>,
        <Button key="cancel" onClick={onClose}>
        Cancel
      </Button>,
]}
    >
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="custom">Custom Size</Radio.Button>
        <Radio.Button value="predefined">Predefined</Radio.Button>
      </Radio.Group>

      <Form form={form} layout="vertical">
        {mode === "custom" ? (
          <>
            <Form.Item label="Length (in)" name="length_in" rules={[{ required: true, message: "Enter length" }]}>
              <InputNumber min={1} style={{ width: "100%" }} autoFocus />
            </Form.Item>
            <Form.Item label="Width (in)" name="width_in" rules={[{ required: true, message: "Enter width" }]}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Height (in)" name="height_in" rules={[{ required: true, message: "Enter height" }]}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Weight (lb)" name="weight">
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="Optional" />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item label="Select Carton Type" name="carton_type_id" rules={[{ required: true, message: "Select a carton" }]}>
              <Select
                showSearch
                placeholder="Search or select a carton"
                optionFilterProp="children"
                filterOption={(input, option) =>
                  option.children.toLowerCase().includes(input.toLowerCase())
                }
              >
                {cartons.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name} ({formatDimension(c.length_in)}×{formatDimension(c.width_in)}×{formatDimension(c.height_in)} in, max {c.max_weight_lb} lb)
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="Weight (lb)" name="weight">
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="Optional" />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}

export default function Orders() {
  const [mode, setMode] = useState("scan");
  const [orderNo, setOrderNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [oesData, setOesData] = useState(null);
  const [pack, setPack] = useState(null);
  const [activeBoxId, setActiveBoxId] = useState(null);
  const [showAddBoxModal, setShowAddBoxModal] = useState(false);

  // Calculate isComplete early
  const isComplete = pack?.header?.status === "complete";

  // Keyboard shortcuts for pack mode
  useEffect(() => {
    const handleKeyPress = async (event) => {
      // Don't trigger if user is typing in an input field
      if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") {
        return;
      }

      // Only trigger in pack mode
      if (!pack || isComplete) return;

      // "+" key to open Add Box modal
      if (event.key === "+" && !showAddBoxModal) {
        setShowAddBoxModal(true);
      }

      // Ctrl+D or Cmd+D to duplicate active box (if we have an active box)
      if ((event.ctrlKey || event.metaKey) && event.key === "d" && activeBoxId) {
        event.preventDefault(); // Prevent browser's bookmark shortcut
        try {
          message.loading({ content: "Duplicating box...", key: "duplicate" });
          const snap = await duplicateBox(pack.header.pack_id, activeBoxId);
          setPack(snap);
          message.success({ content: "Box duplicated successfully", key: "duplicate", duration: 2 });
          // Set the new box as active (it will be the last one in the list)
          const newBoxId = snap.boxes[snap.boxes.length - 1]?.id;
          if (newBoxId) setActiveBoxId(newBoxId);
        } catch (err) {
          // Check if the error contains preventing products
          if (err.response?.data?.detail?.preventing_products) {
            const preventingProducts = err.response.data.detail.preventing_products;
            const productList = preventingProducts.map(p => 
              `${p.product_code} (needs ${p.needed}, has ${p.remaining})`
            ).join(', ');
            message.error({ 
              content: `Cannot duplicate: ${productList}`, 
              key: "duplicate",
              duration: 5
            });
          } else {
            message.error({ content: err.message || "Failed to duplicate box", key: "duplicate" });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [pack, isComplete, showAddBoxModal, activeBoxId]);

  const handleDeleteBox = useCallback(async (boxId) => {
    try {
      const snap = await deleteBox(pack.header.pack_id, boxId);
      setPack(snap);
      message.success("Box deleted");
    } catch (err) {
      message.error(err.message);
    }
  }, [pack]);

  const handleRemoveItem = useCallback(async (boxId, orderLineId, qty = 1) => {
    try {
      const snap = await removeItemFromBox(pack.header.pack_id, boxId, orderLineId, qty);
      setPack(snap);
      message.success("Item removed");
    } catch (err) {
      message.error(err.message);
    }
  }, [pack]);

  async function handleScan(value) {
    if (!value) return;
    setLoading(true);
    try {
      const data = await getOesOrder(value.trim());
      setOesData(data);
      setOrderNo(value.trim());
      // Clear previous pack data
      setPack(null);
      setActiveBoxId(null);
      // Go directly to pack mode instead of preview - pass the order number directly
      await handleStartPack(value.trim());
    } catch {
      message.error("Order not found in OES");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartPack(orderNumber = null) {
    setLoading(true);
    try {
      const orderToUse = orderNumber || orderNo;
      console.log("Starting pack for order:", orderToUse); // Debug log
      const res = await startPack(orderToUse.trim());
      console.log("Pack started successfully:", res); // Debug log
      const snap = await getPackSnapshot(res.pack_id);
      if (snap.header.status === "complete") message.info("This order has already been packed and marked complete.");
      setPack(snap);
      setMode("pack");
      setActiveBoxId(null);
    } catch (err) {
      console.error("Error starting pack:", err); // Debug log
      message.error(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }

  // Reset function for new orders
  function handleNewOrder() {
    setMode("scan");
    setOrderNo("");
    setOesData(null);
    setPack(null);
    setActiveBoxId(null);
  }

  const lineColumns = [
    { title: "Product Code", dataIndex: "product_code" },
    { 
      title: "Length", 
      dataIndex: "length_in",
      render: (value) => formatDimension(value)
    },
    { 
      title: "Height", 
      dataIndex: "height_in",
      render: (value) => formatDimension(value)
    },
    { title: "Qty", dataIndex: "qty_ordered" },
    { title: "Finish", dataIndex: "finish" },
  ];

  if (loading) return <div style={{ textAlign: "center", marginTop: 100 }}><Spin size="large" /></div>;

  if (mode === "scan") return (
    <div style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
      <h2>Scan or Enter Order #</h2>
      <Input.Search placeholder="Order number" enterButton="Search" size="large" onSearch={handleScan} autoFocus />
    </div>
  );


  if (mode === "pack") {
    // Safety check - don't render if we don't have pack data or if order numbers don't match
    if (!pack || !oesData || pack.header.order_no !== orderNo) {
      return <div style={{ textAlign: "center", marginTop: 100 }}><Spin size="large" /></div>;
    }
    
    const packId = pack.header.pack_id;

    async function handleCompletePack() {
      try {
        message.loading({ content: "Completing pack...", key: "complete" });
        const data = await completePack(packId);
        message.success({ content: data.message || "Pack complete", key: "complete", duration: 2 });
        setPack(data);
        setActiveBoxId(null);
      } catch (err) {
        message.error(err.message || "Cannot complete pack");
      }
    }

    async function handleDownloadPackingSlip() {
      const packId = pack.header.pack_id;
      try {
        message.loading({ content: "Generating packing slip...", key: "dl" });
        await downloadPackingSlip(packId);
        message.success({ content: "Packing slip download started.", key: "dl", duration: 2 });
      } catch (err) {
        message.error({ content: err?.message || "Failed to download packing slip.", key: "dl" });
      }
    }

    async function handleAssignQty(lineId, remaining) {
      if (isComplete) return;
      if (!activeBoxId) return message.info("Select a box first");
      if (remaining <= 0) return message.info("Nothing left to assign");

      try {
        await assignOne(packId, activeBoxId, lineId);
        message.success("1 unit assigned");
        const snap = await getPackSnapshot(packId);
        setPack(snap);
      } catch (err) {
        message.error(err.response?.data?.detail || err.message);
      }
    }

    async function handleWeightChange(boxId, value) {
      if (isComplete) return;
      try {
        const snap = await setBoxWeight(packId, boxId, value);
        setPack(snap);
        message.success(`Weight updated (${Math.ceil(value)} lb)`);
      } catch (err) {
        message.error(err.message || "Failed to update weight");
      }
    }

    async function handleDuplicateBox() {
      if (isComplete || !activeBoxId) return;
      try {
        message.loading({ content: "Duplicating box...", key: "duplicate" });
        const snap = await duplicateBox(packId, activeBoxId);
        setPack(snap);
        message.success({ content: "Box duplicated successfully", key: "duplicate", duration: 2 });
        // Set the new box as active (it will be the last one in the list)
        const newBoxId = snap.boxes[snap.boxes.length - 1]?.id;
        if (newBoxId) setActiveBoxId(newBoxId);
      } catch (err) {
        // Check if the error contains preventing products
        if (err.response?.data?.detail?.preventing_products) {
          const preventingProducts = err.response.data.detail.preventing_products;
          const productList = preventingProducts.map(p => 
            `${p.product_code} (needs ${p.needed}, has ${p.remaining})`
          ).join(', ');
          message.error({ 
            content: `Cannot duplicate: ${productList}`, 
            key: "duplicate",
            duration: 5
          });
        } else {
          message.error({ content: err.message || "Failed to duplicate box", key: "duplicate" });
        }
      }
    }


    async function refreshSnapshot(newBoxId = null) {
      const snap = await getPackSnapshot(pack.header.pack_id);
      setPack(snap);
      if (newBoxId) setActiveBoxId(newBoxId);
      else setActiveBoxId(null);
    }

    const allBoxesWeighted = pack.boxes.length > 0 && pack.boxes.every((b) => b.weight_lbs !== null);

    return (
      <div style={{ padding: 24 }}>
        <Collapse 
          defaultActiveKey={['order-info']}
          style={{ 
            marginBottom: 16,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            borderRadius: '12px',
            overflow: 'hidden'
          }}
        >
          <Collapse.Panel 
            key="order-info"
            header={
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                width: '100%',
                padding: '8px 0'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{
                    background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontWeight: '600',
                    fontSize: '16px',
                    boxShadow: '0 2px 4px rgba(22, 119, 255, 0.3)'
                  }}>
                    Packing Order #{pack.header.order_no}
                  </div>
                  <div style={{ color: '#666', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontWeight: '500' }}>Customer:</span> {pack.header.customer_name}
                    <span style={{ fontWeight: '500' }}>Status:</span> 
                    <span style={{ 
                      color: isComplete ? "#52c41a" : "#1677ff", 
                      fontWeight: '600',
                      marginLeft: '4px',
                      padding: '2px 8px',
                      background: isComplete ? '#f6ffed' : '#e6f7ff',
                      borderRadius: '4px',
                      border: `1px solid ${isComplete ? '#b7eb8f' : '#91d5ff'}`
                    }}>
                      {pack.header.status.toUpperCase()}
                    </span>
                    <span style={{ fontWeight: '500' }}>Due Date:</span>
                    <span style={{ 
                      color: '#333', 
                      padding: '2px 8px', 
                      background: '#e6f7ff', 
                      borderRadius: '4px',
                      border: '1px solid #91d5ff'
                    }}>
                      {oesData?.header?.due_date}
                    </span>
                    <span style={{ fontWeight: '500' }}>Lead Time:</span>
                    {getLeadTimeLogo(oesData?.header?.lead_time_plan) ? (
                      <img 
                        src={getLeadTimeLogo(oesData?.header?.lead_time_plan)} 
                        alt={oesData?.header?.lead_time_plan || 'Lead Time'}
                        style={{ 
                          height: '20px', 
                          width: 'auto',
                          maxWidth: '100px',
                          objectFit: 'contain'
                        }}
                      />
                    ) : (
                      <span style={{ color: '#333' }}>{oesData?.header?.lead_time_plan || ''}</span>
                    )}
                  </div>
                </div>
                <Space onClick={(e) => e.stopPropagation()}>
      <Tooltip title="Download Packing Slip (PDF)">
        <Button
          icon={<DownloadOutlined />}
          onClick={handleDownloadPackingSlip}
          disabled={!isComplete}
                      style={{ 
                        background: isComplete ? '#52c41a' : '#f5f5f5',
                        borderColor: isComplete ? '#52c41a' : '#d9d9d9',
                        color: isComplete ? 'white' : '#666'
                      }}
        />
      </Tooltip>

                  <Button 
                    onClick={handleNewOrder}
                    style={{ 
                      background: '#f0f0f0',
                      borderColor: '#d9d9d9',
                      color: '#666'
                    }}
                  >
                    New Order
                  </Button>

      {!isComplete && (
        <Button
          type="primary"
          danger
          onClick={handleCompletePack}
          disabled={!allBoxesWeighted}
                      style={{
                        background: allBoxesWeighted ? '#ff4d4f' : '#f5f5f5',
                        borderColor: allBoxesWeighted ? '#ff4d4f' : '#d9d9d9',
                        color: allBoxesWeighted ? 'white' : '#999'
                      }}
        >
          Complete Pack
        </Button>
      )}
    </Space>
              </div>
            }
            style={{
              border: 'none',
              borderRadius: '0',
              backgroundColor: '#ffffff'
            }}
          >
            <div style={{ 
              padding: '10px',
              background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
              borderTop: '1px solid #e6f7ff'
            }}>
              {/* Combined Customer and Shipping Information */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr', 
                gap: '24px',
                padding: '20px',
                background: '#ffffff',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: '1px solid #f0f0f0'
              }}>
                {/* Customer Information Column */}
                <div>
                  <h4 style={{ 
                    margin: '0 0 16px 0', 
                    color: '#1677ff', 
                    fontSize: '18px',
                    fontWeight: '600',
                    borderBottom: '2px solid #e6f7ff',
                    paddingBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{
                      background: '#1677ff',
                      color: 'white',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>C</span>
                    Bill To
                  </h4>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Name:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.customer_name || pack.header.customer_name}</span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Address:</span>{' '}
                    <span style={{ color: '#333' }}>
                      {[
                        oesData?.header?.customer_address1,
                        oesData?.header?.customer_address2,
                        oesData?.header?.customer_city,
                        oesData?.header?.customer_province,
                        oesData?.header?.customer_country,
                        oesData?.header?.customer_postal_code
                      ].filter(Boolean).join(', ')}
                    </span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Phone:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.customer_phone || ''}</span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Sales Rep:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.sales_rep_name || ''}</span>
                  </p>
                </div>
                
                {/* Shipping Information Column */}
                <div>
                  <h4 style={{ 
                    margin: '0 0 16px 0', 
                    color: '#52c41a', 
                    fontSize: '18px',
                    fontWeight: '600',
                    borderBottom: '2px solid #f6ffed',
                    paddingBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{
                      background: '#52c41a',
                      color: 'white',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>S</span>
                    Ship To
                  </h4>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Name:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.ship_name || ''}</span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Address:</span>{' '}
                    <span style={{ color: '#333' }}>
                      {[
                        oesData?.header?.ship_address1,
                        oesData?.header?.ship_address2,
                        oesData?.header?.ship_city,
                        oesData?.header?.ship_province,
                        oesData?.header?.ship_country,
                        oesData?.header?.ship_postal_code
                      ].filter(Boolean).join(', ')}
                    </span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Attention:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.ship_attention || ''}</span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Phone:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.ship_phone || ''}</span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Email:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.ship_email || ''}</span>
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    <span style={{ fontWeight: '600', color: '#666' }}>Ship By:</span>{' '}
                    <span style={{ color: '#333' }}>{oesData?.header?.ship_by || ''}</span>
                  </p>
                </div>
              </div>
            </div>
          </Collapse.Panel>
        </Collapse>

        <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
          <Card title="Order Lines" style={{ flex: 1 }}>
            <Table size="small" rowKey={(r) => r.id} dataSource={pack.lines} pagination={false}>
              <Table.Column title="Quantity" dataIndex="qty_ordered" />
              <Table.Column title="Product Code" dataIndex="product_code" />
              <Table.Column 
                title="Length (in)" 
                dataIndex="length_in" 
                render={(value) => formatDimension(value)}
              />
              <Table.Column 
                title="Height (in)" 
                dataIndex="height_in" 
                render={(value) => formatDimension(value)}
              />
              <Table.Column title="Finish" dataIndex="finish" />
              <Table.Column title="Remaining" dataIndex="remaining" />
              <Table.Column title="Packed" dataIndex="packed_qty" />
              <Table.Column
                title="Action"
                render={(_, record) => (
                  <Button size="small" onClick={() => handleAssignQty(record.id, record.remaining)} disabled={record.remaining <= 0 || isComplete}>Assign</Button>
                )}
              />
            </Table>
          </Card>

          {/* Collapse-based Boxes */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Boxes ({pack.boxes.length})</h3>
              {!isComplete && (
                <Space>
                  <Button type="primary" size="small" onClick={() => setShowAddBoxModal(true)}>+ Add Box</Button>
                  <Tooltip title="Duplicate Active Box">
                    <Button 
                      size="small" 
                      icon={<CopyOutlined />}
                      onClick={handleDuplicateBox}
                      disabled={!activeBoxId}
                    >
                      Duplicate
                    </Button>
                  </Tooltip>
                </Space>
              )}
            </div>

            <div 
              style={{ 
                maxHeight: '600px', // Approximately 10 boxes at ~60px each
                overflowY: 'auto',
                border: '1px solid #d9d9d9',
                borderRadius: '6px',
                padding: '8px',
                // Custom scrollbar styling
                scrollbarWidth: 'thin',
                scrollbarColor: '#bfbfbf #f0f0f0',
                position: 'relative'
              }}
            >
              {pack.boxes.length > 10 && (
                <div style={{
                  position: 'absolute',
                  top: '4px',
                  right: '8px',
                  background: '#1677ff',
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  zIndex: 10,
                  pointerEvents: 'none'
                }}>
                  Scroll to see more
                </div>
              )}
              <Collapse multiple>
                {pack.boxes.map((b) => {
                const totalQty = b.items.reduce((sum, it) => sum + it.qty, 0);
                const canDelete = !isComplete && b.items.length === 0;
                const header = (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      <b>{b.label}</b>
                      <span style={{ color: "#888", marginLeft: 6 }}>
                        {b.weight_lbs ? ` | ${b.weight_lbs} lb` : ""}
                        {totalQty ? ` | ${totalQty} pcs` : ""}
                      </span>
                    </span>
                    {canDelete && (
                      <DeleteOutlined
                        style={{ color: "#ff4d4f", fontSize: 20 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBox(b.id);
                        }}
                      />
                    )}
                  </div>
                );

                return (
                  <Collapse.Panel
                    key={b.id}
                    header={header}
                    style={{
                      border: activeBoxId === b.id ? "1px solid #1677ff" : "1px solid #ddd",
                      borderRadius: 8,
                      backgroundColor: b.weight_lbs ? "#fff" : "#fff4f4",
                      marginBottom: 8,
                    }}
                    onClick={() => setActiveBoxId(b.id)}
                  >
                    <AnimatePresence>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <div style={{ marginTop: 8 }}>
                          <b>Weight (lb):</b>{" "}
                          <InputNumber
                            min={0}
                            step={1}
                            value={b.weight_entered ?? null}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(val) => handleWeightChange(b.id, val)}
                            style={{ width: 100 }}
                            placeholder="Enter"
                            disabled={isComplete}
                          />
                        </div>

                        {b.items.length === 0 ? (
                          <i style={{ display: "block", marginTop: 8 }}>Empty box</i>
                        ) : (
                          b.items.map((it) => (
                            <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                              <span>{`${it.product_code} ${formatDimension(it.length_in)} x ${formatDimension(it.height_in)} - Qty: ${it.qty}`}</span>
                              {!isComplete && (
                                <MinusCircleOutlined
                                  style={{ color: "#ff4d4f", fontSize: 16, cursor: "pointer" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveItem(b.id, it.order_line_id, 1);
                                  }}
                                />
                              )}
                            </div>
                          ))
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </Collapse.Panel>
                );
              })}
              </Collapse>
            </div>
          </div>
        </div>

        <AddBoxModal visible={showAddBoxModal} onClose={() => setShowAddBoxModal(false)} packId={pack.header.pack_id} onBoxAdded={refreshSnapshot} />
      </div>
    );
  }

  return null;
}

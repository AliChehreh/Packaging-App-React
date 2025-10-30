// src/pages/Orders.jsx — use Ant Design Collapse for Boxes
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
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
  PlusOutlined,
  MinusOutlined,
  DoubleRightOutlined,
  DoubleLeftOutlined,
  PrinterOutlined,
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
  printBoxLabel,
  printAllBoxLabels,
  previewPackingSlipHtml,
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

// Helper function to format phone numbers to standard (xxx) xxx-xxxx format
function formatPhone(value) {
  if (!value) return '';
  
  // Remove all non-digit characters
  const digits = value.toString().replace(/\D/g, '');
  
  // If we have 10 digits, format as (xxx) xxx-xxxx
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  
  // If we have 11 digits starting with 1, format as (xxx) xxx-xxxx
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  // For other lengths, return as-is (might be international format)
  return value;
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

  const handleOk = useCallback(async () => {
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
  }, [form, mode, packId, onBoxAdded, onClose]);

  useEffect(() => {
    if (visible && mode === "predefined") {
      listCartonTypes()
        .then(setCartons)
        .catch(() => message.error("Failed to load carton list"));
    }
  }, [visible, mode]);

  // Handle Enter key press
  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!visible) return;
      
      if (event.key === 'Enter') {
        // Check if user is typing in any input field
        const activeElement = document.activeElement;
        const isTyping = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.classList.contains('ant-select-selector') ||
          activeElement.closest('.ant-select')
        );
        
        if (isTyping) {
          event.preventDefault();
          event.stopPropagation();
          console.log('Enter key pressed in input field - triggering Add Box');
          handleOk();
        }
      }
    };

    if (visible) {
      document.addEventListener('keydown', handleKeyPress);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [visible, handleOk]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            background: 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
            color: 'white',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: 'bold'
          }}>
            ADD BOX
          </span>
          <span style={{ fontSize: '16px', fontWeight: '600' }}>New Box</span>
        </div>
      }
      open={visible}
      onOk={handleOk}
      onCancel={onClose}
      okText="Add Box"
      cancelText="Cancel"
      destroyOnClose
      footer={[
        <Button key="add" type="primary" onClick={handleOk} style={{ borderRadius: '6px' }}>
          Add Box
        </Button>,
<Button key="cancel" onClick={onClose} style={{ borderRadius: '6px' }}>
          Cancel
        </Button>,

      ]}
      width={500}
      style={{ top: 80 }}
    >
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        style={{ 
          marginBottom: 20,
          display: 'flex',
          width: '100%'
        }}
        size="large"
      >
        <Radio.Button value="custom" style={{ flex: 1, textAlign: 'center' }}>Custom Size</Radio.Button>
        <Radio.Button value="predefined" style={{ flex: 1, textAlign: 'center' }}>Predefined</Radio.Button>
      </Radio.Group>

      <Form form={form} layout="vertical" style={{ marginTop: '8px' }}>
        {mode === "custom" ? (
          <>
            <Form.Item 
              label={<span style={{ fontWeight: '600' }}>Length (in)</span>} 
              name="length_in" 
              rules={[{ required: true, message: "Enter length" }]}
            >
              <InputNumber min={1} style={{ width: "100%" }} autoFocus size="large" />
            </Form.Item>
            <Form.Item 
              label={<span style={{ fontWeight: '600' }}>Width (in)</span>} 
              name="width_in" 
              rules={[{ required: true, message: "Enter width" }]}
            >
              <InputNumber min={1} style={{ width: "100%" }} size="large" />
            </Form.Item>
            <Form.Item 
              label={<span style={{ fontWeight: '600' }}>Height (in)</span>} 
              name="height_in" 
              rules={[{ required: true, message: "Enter height" }]}
            >
              <InputNumber min={1} style={{ width: "100%" }} size="large" />
            </Form.Item>
            <Form.Item 
              label={<span style={{ fontWeight: '600' }}>Weight (lb)</span>} 
              name="weight"
            >
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="Optional" size="large" />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item 
              label={<span style={{ fontWeight: '600' }}>Select Carton Type</span>} 
              name="carton_type_id" 
              rules={[{ required: true, message: "Select a carton" }]}
            >
              <Select
                showSearch
                placeholder="Search or select a carton"
                optionFilterProp="children"
                filterOption={(input, option) =>
                  option.children.toLowerCase().includes(input.toLowerCase())
                }
                size="large"
              >
                {cartons.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name} ({formatDimension(c.length_in)}×{formatDimension(c.width_in)}×{formatDimension(c.height_in)} in, max {c.max_weight_lb} lb)
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item 
              label={<span style={{ fontWeight: '600' }}>Weight (lb)</span>} 
              name="weight"
            >
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="Optional" size="large" />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}

export default function Orders() {
  const location = useLocation();
  const [mode, setMode] = useState("scan");
  const [orderNo, setOrderNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [oesData, setOesData] = useState(null);
  const [pack, setPack] = useState(null);
  const [activeBoxId, setActiveBoxId] = useState(null);
  const [showAddBoxModal, setShowAddBoxModal] = useState(false);

  // Calculate isComplete early
  const isComplete = pack?.header?.status === "complete";

  // Handle URL parameters for auto-loading orders
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const orderParam = searchParams.get('order');
    if (orderParam && orderParam !== orderNo) {
      // Auto-trigger order loading using the existing handleScan function
      handleScan(orderParam);
    }
  }, [location.search]);

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

  if (loading) return (
    <div style={{ 
      textAlign: "center", 
      marginTop: 100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px'
    }}>
      <Spin size="large" />
      <span style={{ color: '#666', fontSize: '14px' }}>Loading...</span>
    </div>
  );

  if (mode === "scan") return (
    <div style={{ 
      maxWidth: 500, 
      margin: "100px auto", 
      textAlign: "center",
      padding: '40px',
      background: 'linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%)',
      borderRadius: '16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
    }}>
      <div style={{
        marginBottom: '32px'
      }}>
        <h2 style={{ 
          margin: '0 0 8px 0',
          fontSize: '28px',
          fontWeight: '600',
          color: '#1677ff',
          letterSpacing: '-0.5px'
        }}>
          Scan or Enter Order #
        </h2>
        <p style={{ 
          margin: 0,
          color: '#666',
          fontSize: '14px'
        }}>
          Enter the order number to begin packing
        </p>
      </div>
      <Input.Search 
        placeholder="Order number" 
        enterButton="Search" 
        size="large" 
        onSearch={handleScan} 
        autoFocus
        style={{
          maxWidth: '400px'
        }}
      />
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

    async function handlePrintBoxLabel(boxId) {
      const packId = pack.header.pack_id;
      try {
        // Get printer settings from localStorage
        const boxLabelPrinter = localStorage.getItem('boxLabelPrinter');
        
        if (!boxLabelPrinter) {
          message.error({ content: "Please select a box label printer in Settings first.", key: "print" });
          return;
        }

        message.loading({ content: `Printing box label to ${boxLabelPrinter}...`, key: "print" });
        
        // Call the actual API endpoint
        const result = await printBoxLabel(packId, boxId);
        
        message.success({ content: result.message, key: "print", duration: 2 });
      } catch (err) {
        message.error({ content: err?.message || "Failed to print box label.", key: "print" });
      }
    }

    async function handlePrintAllLabels() {
      const packId = pack.header.pack_id;
      try {
        // Get printer settings from localStorage
        const boxLabelPrinter = localStorage.getItem('boxLabelPrinter');
        
        if (!boxLabelPrinter) {
          message.error({ content: "Please select a box label printer in Settings first.", key: "printAll" });
          return;
        }

        // Filter boxes that have items
        const boxesWithItems = pack.boxes.filter(box => box.items.length > 0);
        
        if (boxesWithItems.length === 0) {
          message.warning({ content: "No boxes with items to print.", key: "printAll" });
          return;
        }

        message.loading({ content: `Printing ${boxesWithItems.length} box labels to ${boxLabelPrinter}...`, key: "printAll" });
        
        // Call the actual API endpoint
        const result = await printAllBoxLabels(packId);
        
        message.success({ content: result.message, key: "printAll", duration: 3 });
      } catch (err) {
        message.error({ content: err?.message || "Failed to print all box labels.", key: "printAll" });
      }
    }

    function handlePrintPackingSlip() {
      const packId = pack.header.pack_id;
      try {
        // Open packing slip HTML preview (which will open print dialog)
        previewPackingSlipHtml(packId);
      } catch (err) {
        message.error({ content: err?.message || "Failed to open packing slip preview.", key: "packingSlip" });
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

    async function handleRemoveFromBox(lineId) {
      if (isComplete) return;
      if (!activeBoxId) return message.info("Select a box first");

      try {
        await removeItemFromBox(packId, activeBoxId, lineId, 1);
        message.success("1 unit removed");
        const snap = await getPackSnapshot(packId);
        setPack(snap);
      } catch (err) {
        message.error(err.response?.data?.detail || err.message);
      }
    }

    async function handleAssignAll(lineId, remaining) {
      if (isComplete) return;
      if (!activeBoxId) return message.info("Select a box first");
      if (remaining <= 0) return message.info("Nothing left to assign");

      try {
        // Assign all remaining items one by one
        for (let i = 0; i < remaining; i++) {
          await assignOne(packId, activeBoxId, lineId);
        }
        message.success(`${remaining} units assigned`);
        const snap = await getPackSnapshot(packId);
        setPack(snap);
      } catch (err) {
        message.error(err.response?.data?.detail || err.message);
      }
    }

    async function handleRemoveAll(lineId, packedQty) {
      if (isComplete) return;
      if (!activeBoxId) return message.info("Select a box first");
      if (packedQty <= 0) return message.info("Nothing packed to remove");

      try {
        // Remove all packed items one by one
        for (let i = 0; i < packedQty; i++) {
          await removeItemFromBox(packId, activeBoxId, lineId, 1);
        }
        message.success(`${packedQty} units removed`);
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
      <div style={{ padding: '0' }}>
        <Collapse 
          defaultActiveKey={[]}
          style={{ 
            marginBottom: 20,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid #e6f7ff'
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
                    Order #{pack.header.order_no}
                  </div>
                  <div style={{ color: '#666', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                          height: '30px', 
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
      <Button 
        onClick={handleNewOrder}
        style={{ 
          background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
          borderColor: '#1677ff',
          color: 'white',
          borderRadius: '6px',
          fontWeight: '500',
          boxShadow: '0 2px 8px rgba(22, 119, 255, 0.3)'
        }}
      >
        New Order
      </Button>
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
                    <span style={{ color: '#333' }}>{formatPhone(oesData?.header?.customer_phone || '')}</span>
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
                    <span style={{ color: '#333' }}>{formatPhone(oesData?.header?.ship_phone || '')}</span>
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

        <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
          <Card 
            title={
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                fontSize: '16px',
                fontWeight: '600'
              }}>
                <span style={{
                  background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                  color: 'white',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}>
                  ORDER LINES
                </span>
                <span style={{ color: '#666', fontWeight: 'normal', fontSize: '14px' }}>
                  ({pack.lines.length} items)
                </span>
              </div>
            }
            style={{ 
              flex: 2,
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              border: '1px solid #f0f0f0'
            }}
            headStyle={{
              background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
              borderBottom: '2px solid #e6f7ff',
              borderRadius: '12px 12px 0 0'
            }}
          >
            <Table 
              size="small" 
              rowKey={(r) => r.id} 
              dataSource={pack.lines} 
              pagination={false}
              style={{
                borderRadius: '8px'
              }}
            >
              <Table.Column 
                title={<span style={{ fontWeight: '600' }}>Qty</span>} 
                dataIndex="qty_ordered"
                width={70}
              />
              <Table.Column 
                title={<span style={{ fontWeight: '600' }}>Product Code</span>} 
                dataIndex="product_code"
                width={150}
              />
              <Table.Column 
                title={<span style={{ fontWeight: '600' }}>Length (in)</span>} 
                dataIndex="length_in" 
                render={(value) => formatDimension(value)}
                width={100}
              />
              <Table.Column 
                title={<span style={{ fontWeight: '600' }}>Height (in)</span>} 
                dataIndex="height_in" 
                render={(value) => formatDimension(value)}
                width={100}
              />
              <Table.Column 
                title={<span style={{ fontWeight: '600' }}>Finish</span>} 
                dataIndex="finish"
                width={100}
              />
              <Table.Column 
                title={<span style={{ fontWeight: '600', background: '#fff1f0', color: '#ff4d4f', padding: '4px 8px', borderRadius: '4px' }}>Remaining</span>} 
                dataIndex="remaining"
                width={100}
                render={(value) => (
                  <span style={{ 
                    color: value > 0 ? '#ff4d4f' : '#52c41a',
                    fontWeight: '600'
                  }}>
                    {value}
                  </span>
                )}
              />
              <Table.Column 
                title={<span style={{ fontWeight: '600', background: '#e6f7ff', color: '#1677ff', padding: '4px 8px', borderRadius: '4px' }}>Packed</span>} 
                dataIndex="packed_qty"
                width={80}
                render={(value) => (
                  <span style={{ 
                    color: '#1677ff',
                    fontWeight: '600'
                  }}>
                    {value}
                  </span>
                )}
              />
               <Table.Column
                 title={<span style={{ fontWeight: '600', background: '#f6ffed', color: '#52c41a', padding: '4px 8px', borderRadius: '4px' }}>Action</span>}
                 width={200}
                 render={(_, record) => (
                   <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                     {/* Single Operations Group */}
                     <div style={{ 
                       display: 'flex', 
                       gap: '2px', 
                       padding: '2px',
                       background: '#f0f8ff',
                       borderRadius: '8px',
                       border: '1px solid #91d5ff'
                     }}>
                       <Tooltip title="Assign to Current Box">
                         <Button 
                           size="small" 
                           type="primary"
                           icon={<PlusOutlined />}
                           onClick={() => {
                             if (pack.boxes.length === 0) {
                               setShowAddBoxModal(true);
                             } else {
                               handleAssignQty(record.id, record.remaining);
                             }
                           }} 
                           disabled={record.remaining <= 0 || isComplete}
                           style={{
                             borderRadius: '4px',
                             display: 'flex',
                             alignItems: 'center',
                             justifyContent: 'center',
                             minWidth: '28px',
                             height: '24px',
                             border: 'none'
                           }}
                         />
                       </Tooltip>
                       <Tooltip title="Remove from Current Box">
                         <Button 
                           size="small" 
                           danger
                           icon={<MinusOutlined />}
                           onClick={() => handleRemoveFromBox(record.id)} 
                           disabled={record.packed_qty <= 0 || isComplete || !activeBoxId}
                           style={{
                             borderRadius: '4px',
                             display: 'flex',
                             alignItems: 'center',
                             justifyContent: 'center',
                             minWidth: '28px',
                             height: '24px',
                             border: 'none'
                           }}
                         />
                       </Tooltip>
                     </div>
                     
                     {/* Bulk Operations Group */}
                     <div style={{ 
                       display: 'flex', 
                       gap: '2px', 
                       padding: '2px',
                       background: '#fff7e6',
                       borderRadius: '8px',
                       border: '1px solid #91d5ff'
                     }}>
                       <Tooltip title="Assign All Remaining">
                         <Button 
                           size="small" 
                           type="primary"
                           icon={<DoubleRightOutlined />}
                           onClick={() => {
                             if (pack.boxes.length === 0) {
                               setShowAddBoxModal(true);
                             } else {
                               handleAssignAll(record.id, record.remaining);
                             }
                           }} 
                           disabled={record.remaining <= 0 || isComplete}
                           style={{
                             borderRadius: '4px',
                             display: 'flex',
                             alignItems: 'center',
                             justifyContent: 'center',
                             minWidth: '28px',
                             height: '24px',
                             background: (record.remaining <= 0 || isComplete) ? '#d9d9d9' : '#13c2c2',
                             borderColor: (record.remaining <= 0 || isComplete) ? '#d9d9d9' : '#13c2c2',
                             border: 'none',
                             color: (record.remaining <= 0 || isComplete) ? '#999' : 'white'
                           }}
                         />
                       </Tooltip>
                       <Tooltip title="Remove All Packed">
                         <Button 
                           size="small" 
                           danger
                           icon={<DoubleLeftOutlined />}
                           onClick={() => handleRemoveAll(record.id, record.packed_qty)} 
                           disabled={record.packed_qty <= 0 || isComplete || !activeBoxId}
                           style={{
                             borderRadius: '4px',
                             display: 'flex',
                             alignItems: 'center',
                             justifyContent: 'center',
                             minWidth: '28px',
                             height: '24px',
                             background: (record.packed_qty <= 0 || isComplete || !activeBoxId) ? '#d9d9d9' : '#ff7875',
                             borderColor: (record.packed_qty <= 0 || isComplete || !activeBoxId) ? '#d9d9d9' : '#ff7875',
                             border: 'none',
                             color: (record.packed_qty <= 0 || isComplete || !activeBoxId) ? '#999' : 'white'
                           }}
                         />
                       </Tooltip>
                     </div>
                   </div>
                 )}
               />
            </Table>
          </Card>

          {/* Collapse-based Boxes */}
          <div style={{ flex: 1, minWidth: '400px' }}>
            <div style={{ 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center", 
              marginBottom: 16,
              padding: '12px 16px',
              background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
              borderRadius: '12px',
              border: '1px solid #e6f7ff'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{
                  background: 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
                  color: 'white',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}>
                  BOXES
                </span>
                <h3 style={{ 
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#333'
                }}>
                  ({pack.boxes.length} {pack.boxes.length === 1 ? 'box' : 'boxes'})
                </h3>
              </div>
              {!isComplete && (
                <Space>
                  <Button 
                    type="primary" 
                    size="small" 
                    onClick={() => setShowAddBoxModal(true)}
                    style={{
                      fontWeight: '500',
                      borderRadius: '6px',
                      boxShadow: '0 2px 4px rgba(22, 119, 255, 0.2)'
                    }}
                  >
                    + Add Box
                  </Button>
                  <Tooltip title="Duplicate Active Box (Ctrl+D)">
                    <Button 
                      size="small" 
                      icon={<CopyOutlined />}
                      onClick={handleDuplicateBox}
                      disabled={!activeBoxId}
                      style={{
                        borderRadius: '6px'
                      }}
                    >
                      Duplicate
                    </Button>
                  </Tooltip>
                </Space>
              )}
              {isComplete && pack.boxes.some(box => box.items.length > 0) && (
                <>
                  <Tooltip title="Print All Box Labels">
                    <Button 
                      type="primary" 
                      size="small" 
                      icon={<PrinterOutlined />}
                      onClick={handlePrintAllLabels}
                      style={{
                        fontWeight: '500',
                        borderRadius: '6px',
                        background: '#52c41a',
                        borderColor: '#52c41a',
                        boxShadow: '0 2px 4px rgba(82, 196, 26, 0.2)',
                        marginRight: '8px'
                      }}
                    >
                      Print All Labels
                    </Button>
                  </Tooltip>
                  <Tooltip title="Print Packing Slip">
                    <Button 
                      type="primary" 
                      size="small" 
                      icon={<PrinterOutlined />}
                      onClick={handlePrintPackingSlip}
                      style={{
                        fontWeight: '500',
                        borderRadius: '6px',
                        background: '#1677ff',
                        borderColor: '#1677ff',
                        boxShadow: '0 2px 4px rgba(22, 119, 255, 0.2)'
                      }}
                    >
                      Print Packing Slip
                    </Button>
                  </Tooltip>
                </>
              )}
            </div>

            <div 
              style={{ 
                maxHeight: '600px',
                overflowY: 'auto',
                border: '1px solid #e6f7ff',
                borderRadius: '12px',
                padding: '12px',
                background: '#fafafa',
                // Custom scrollbar styling
                scrollbarWidth: 'thin',
                scrollbarColor: '#1677ff #f0f0f0',
                position: 'relative',
                boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.04)'
              }}
            >
              {pack.boxes.length > 10 && (
                <div style={{
                  position: 'sticky',
                  top: '4px',
                  display: 'flex',
                  justifyContent: 'center',
                  marginBottom: '8px',
                  zIndex: 10,
                  pointerEvents: 'none'
                }}>
                  <div style={{
                    background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '500',
                    boxShadow: '0 2px 8px rgba(22, 119, 255, 0.3)'
                  }}>
                    ↓ Scroll to see more ({pack.boxes.length} total)
                  </div>
                </div>
              )}
              <Collapse multiple>
                {pack.boxes.map((b) => {
                const totalQty = b.items.reduce((sum, it) => sum + it.qty, 0);
                const canDelete = !isComplete && b.items.length === 0;
                const header = (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{
                        background: activeBoxId === b.id ? 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)' : '#f0f0f0',
                        color: activeBoxId === b.id ? 'white' : '#666',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontWeight: '700',
                        fontSize: '14px',
                        transition: 'all 0.2s ease'
                      }}>
                        {b.label}
                      </span>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {b.weight_lbs && (
                          <span style={{ 
                            color: "#52c41a", 
                            fontSize: '13px',
                            fontWeight: '600',
                            background: '#f6ffed',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid #b7eb8f'
                          }}>
                            {b.weight_lbs} lb
                          </span>
                        )}
                        {totalQty > 0 && (
                          <span style={{ 
                            color: "#1677ff", 
                            fontSize: '13px',
                            fontWeight: '600',
                            background: '#e6f7ff',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid #91d5ff'
                          }}>
                            {totalQty} pcs
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {canDelete && (
                        <Tooltip title="Delete empty box">
                          <DeleteOutlined
                            style={{ 
                              color: "#ff4d4f", 
                              fontSize: 18,
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.target.style.background = '#fff1f0';
                              e.target.style.transform = 'scale(1.1)';
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = 'transparent';
                              e.target.style.transform = 'scale(1)';
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBox(b.id);
                            }}
                          />
                        </Tooltip>
                      )}
                      {isComplete && totalQty > 0 && (
                        <Tooltip title="Print Box Label">
                          <PrinterOutlined
                            style={{ 
                              color: "#52c41a", 
                              fontSize: 18,
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.target.style.background = '#f6ffed';
                              e.target.style.transform = 'scale(1.1)';
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = 'transparent';
                              e.target.style.transform = 'scale(1)';
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePrintBoxLabel(b.id);
                            }}
                          />
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );

                return (
                  <Collapse.Panel
                    key={b.id}
                    header={header}
                    style={{
                      border: activeBoxId === b.id ? "2px solid #1677ff" : "1px solid #e0e0e0",
                      borderRadius: '10px',
                      backgroundColor: b.weight_lbs ? "#ffffff" : "#fffafa",
                      marginBottom: 10,
                      boxShadow: activeBoxId === b.id ? '0 4px 12px rgba(22, 119, 255, 0.15)' : '0 2px 4px rgba(0,0,0,0.06)',
                      transition: 'all 0.2s ease',
                      overflow: 'hidden'
                    }}
                    onClick={() => setActiveBoxId(b.id)}
                  >
                    <AnimatePresence>
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <div style={{ 
                          marginBottom: 16,
                          padding: '12px',
                          background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
                          borderRadius: '8px',
                          border: '1px solid #e6f7ff'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: '600', color: '#666', fontSize: '14px' }}>Weight (lb):</span>
                            <InputNumber
                              min={0}
                              step={1}
                              value={b.weight_entered ?? null}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(val) => handleWeightChange(b.id, val)}
                              style={{ width: 120 }}
                              placeholder="Enter weight"
                              disabled={isComplete}
                            />
                          </div>
                        </div>

                        {b.items.length === 0 ? (
                          <div style={{ 
                            textAlign: 'center', 
                            padding: '20px',
                            color: '#999',
                            fontStyle: 'italic',
                            background: '#fafafa',
                            borderRadius: '8px',
                            border: '1px dashed #d9d9d9'
                          }}>
                            Empty box
                          </div>
                        ) : (
                          <div style={{
                            background: '#fafafa',
                            borderRadius: '8px',
                            padding: '8px',
                            border: '1px solid #f0f0f0'
                          }}>
                            {b.items.map((it, idx) => (
                              <div 
                                key={it.id} 
                                style={{ 
                                  display: "flex", 
                                  justifyContent: "space-between", 
                                  alignItems: "center", 
                                  padding: '8px 12px',
                                  marginBottom: idx !== b.items.length - 1 ? '4px' : '0',
                                  background: 'white',
                                  borderRadius: '6px',
                                  border: '1px solid #f0f0f0',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderColor = '#1677ff';
                                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(22, 119, 255, 0.1)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderColor = '#f0f0f0';
                                  e.currentTarget.style.boxShadow = 'none';
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontWeight: '600', color: '#1677ff' }}>{it.product_code}</span>
                                  <span style={{ color: '#666', fontSize: '13px' }}>
                                    {formatDimension(it.length_in)} × {formatDimension(it.height_in)}
                                  </span>
                                  <span style={{ 
                                    background: '#e6f7ff',
                                    color: '#1677ff',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    fontWeight: '600'
                                  }}>
                                    Qty: {it.qty}
                                  </span>
                                </div>
                                {!isComplete && (
                                  <Tooltip title="Remove item">
                                    <MinusCircleOutlined
                                      style={{ 
                                        color: "#ff4d4f", 
                                        fontSize: 18, 
                                        cursor: "pointer",
                                        padding: '4px',
                                        borderRadius: '4px',
                                        transition: 'all 0.2s ease'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.target.style.background = '#fff1f0';
                                        e.target.style.transform = 'scale(1.15)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.target.style.background = 'transparent';
                                        e.target.style.transform = 'scale(1)';
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveItem(b.id, it.order_line_id, 1);
                                      }}
                                    />
                                  </Tooltip>
                                )}
                              </div>
                            ))}
                          </div>
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

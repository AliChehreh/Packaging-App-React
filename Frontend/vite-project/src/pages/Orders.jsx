// src/pages/Orders.jsx — Stable + Weight Edit Fix
import { useState, useEffect } from "react";
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
} from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  MinusCircleOutlined,
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
} from "../api/packs";
import { listCartonTypes } from "../api/cartons";

/* ---------------------- AddBoxModal ---------------------- */
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
      message.success("Box created");
      await onBoxAdded(res.id); // auto-select newly added box
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
      destroyOnClose
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
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Width (in)" name="width_in" rules={[{ required: true, message: "Enter width" }]}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Height (in)" name="height_in" rules={[{ required: true, message: "Enter height" }]}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
          </>
        ) : (
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
                  {c.name} ({c.length_in}×{c.width_in}×{c.height_in} in, max {c.max_weight_lb} lb)
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

/* ---------------------- Orders Page ---------------------- */
export default function Orders() {
  const [mode, setMode] = useState("scan");
  const [orderNo, setOrderNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [oesData, setOesData] = useState(null);
  const [pack, setPack] = useState(null);
  const [activeBoxId, setActiveBoxId] = useState(null);
  const [showAddBoxModal, setShowAddBoxModal] = useState(false);
  const [openBoxes, setOpenBoxes] = useState([]);

  async function handleScan(value) {
    if (!value) return;
    setLoading(true);
    try {
      const data = await getOesOrder(value.trim());
      setOesData(data);
      setOrderNo(value.trim());
      setMode("preview");
    } catch {
      message.error("Order not found in OES");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartPack() {
    setLoading(true);
    try {
      const res = await startPack(orderNo.trim());
      const snap = await getPackSnapshot(res.pack_id);
      if (snap.header.status === "complete") message.info("This order has already been packed and marked complete.");
      setPack(snap);
      setMode("pack");
      setActiveBoxId(null);
    } catch (err) {
      message.error(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }

  const lineColumns = [
    { title: "Product Code", dataIndex: "product_code" },
    { title: "Length", dataIndex: "length_in" },
    { title: "Height", dataIndex: "height_in" },
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

  if (mode === "preview") return (
    <div style={{ padding: 24 }}>
      <Card title={`Order #${orderNo}`} style={{ marginBottom: 16 }}>
        <p><b>Customer:</b> {oesData?.header?.customer_name}</p>
        <p><b>Ship To:</b> {oesData?.header?.ship_name}</p>
        <p><b>Due Date:</b> {oesData?.header?.due_date}</p>
      </Card>
      <Table rowKey={(r, i) => `${r.product_code}-${i}`} dataSource={oesData?.lines || []} columns={lineColumns} pagination={false} />
      <div style={{ marginTop: 16 }}>
        <Space>
          <Button type="primary" onClick={handleStartPack}>Start Pack</Button>
          <Button onClick={() => setMode("scan")}>Back</Button>
        </Space>
      </div>
    </div>
  );

  if (mode === "pack") {
    const packId = pack.header.pack_id;
    const isComplete = pack.header.status === "complete";

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

    async function handleAssignQty(lineId, remaining) {
      if (isComplete) return;
      if (!activeBoxId) return message.info("Select a box first");
      if (remaining <= 0) return message.info("Nothing left to assign");

      try {
        await assignOne(packId, activeBoxId, lineId); // ✅ correct order
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

    async function refreshSnapshot(newBoxId = null) {
      const snap = await getPackSnapshot(pack.header.pack_id);
      setPack(snap);
      if (newBoxId) setActiveBoxId(newBoxId);
      else setActiveBoxId(null);
    }

    const allBoxesWeighted = pack.boxes.length > 0 && pack.boxes.every((b) => b.weight_lbs !== null);

    return (
      <div style={{ padding: 24 }}>
        <Card title={`Packing Order #${pack.header.order_no}`} extra={<Space><Button onClick={() => setMode("scan")}>New Order</Button>{!isComplete && (<Button type="primary" danger onClick={handleCompletePack} disabled={!allBoxesWeighted}>Complete Pack</Button>)}</Space>}>
          <p><b>Customer:</b> {pack.header.customer_name} | <b>Status:</b> <span style={{ color: isComplete ? "green" : "#1677ff" }}>{pack.header.status.toUpperCase()}</span></p>
        </Card>

        <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
          <Card title="Order Lines" style={{ flex: 1 }}>
            <Table size="small" rowKey={(r) => r.id} dataSource={pack.lines} pagination={false}>
              <Table.Column title="Product" dataIndex="product_code" />
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

          <Card title={<Space>Boxes<Button type="primary" size="small" onClick={() => setShowAddBoxModal(true)} disabled={isComplete}>+ Add Box</Button></Space>} style={{ flex: 1 }}>
            {pack.boxes.length === 0 ? (<p>No boxes yet.</p>) : pack.boxes.map((b) => {
              const isOpen = openBoxes.includes(b.id);
              const totalQty = b.items.reduce((sum, it) => sum + it.qty, 0);
              const canDelete = !isComplete && b.items.length === 0;

              const toggleBox = (e) => {
                e.stopPropagation();
                if (isOpen) setOpenBoxes(openBoxes.filter((id) => id !== b.id));
                else setOpenBoxes([...openBoxes, b.id]);
                setActiveBoxId(b.id);
              };

              return (
                <Card
                  key={b.id}
                  size="small"
                  style={{
                    marginBottom: 8,
                    border: activeBoxId === b.id ? "2px solid #1677ff" : "1px solid #f0f0f0",
                    backgroundColor: b.weight_lbs ? "#ffffff" : "#fff4f4",
                    cursor: "pointer",
                  }}
                  onClick={toggleBox}
                  title={
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3 }} style={{ display: "flex", alignItems: "center" }}>
                          <DownOutlined />
                        </motion.div>
                        <span>
                          <b>{b.label}</b>
                          {!isOpen && (
                            <span style={{ color: "#888" }}>
                              {b.weight_lbs ? ` | ${b.weight_lbs} lb` : ""}
                              {totalQty ? ` | ${totalQty} pcs` : ""}
                            </span>
                          )}
                        </span>
                      </div>
                      <DeleteOutlined style={{ color: canDelete ? "#ff4d4f" : "#ccc" }} />
                    </div>
                  }
                >
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}>
                        <div style={{ marginBottom: 8 }}>
                          <b>Weight (lb):</b>{" "}
                          {/* ✅ Prevent collapse when editing weight */}
                          <InputNumber
                            min={0}
                            step={0.1}
                            value={b.weight_entered ?? null}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(val) => handleWeightChange(b.id, val)}
                            style={{ width: 100 }}
                            placeholder="Enter"
                            disabled={isComplete}
                          />
                        </div>
                        {b.items.length === 0 ? (
                          <i>Empty box</i>
                        ) : (
                          b.items.map((it) => (
                            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <MinusCircleOutlined style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 14 }} />
                              <span>{it.product_code} × {it.qty}</span>
                            </div>
                          ))
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}
          </Card>
        </div>

        <AddBoxModal visible={showAddBoxModal} onClose={() => setShowAddBoxModal(false)} packId={pack.header.pack_id} onBoxAdded={refreshSnapshot} />
      </div>
    );
  }

  return null;
}
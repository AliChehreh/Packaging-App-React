import { useEffect, useMemo, useState } from "react";
import {
  Table, Typography, Input, Space, Alert, Button, Switch,
  Modal, Form, InputNumber, Checkbox, message
} from "antd";
import {
  listCartons, createCarton, updateCarton, adjustInventory
} from "../api/cartons";

const { Title, Text } = Typography;

// Helpers to normalize API rows (works with either snake_case or TitleCase)
const get = (r, a, b) => r?.[a] ?? r?.[b];
const toNum = (v) => (v === null || v === undefined || v === "" ? Number.NEGATIVE_INFINITY : Number(v));
const toStr = (v) => (v === null || v === undefined ? "" : String(v));

export default function Cartons() {
  const [rows, setRows] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // selection state for Edit/Adjust actions
  const [selected, setSelected] = useState(null);

  // dialogs
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [form] = Form.useForm();
  const [adjustForm] = Form.useForm();

  // dynamic table height so the scroll area fits the screen
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const tableHeight = useMemo(() => Math.max(320, vh - 220), [vh]); // tune offset as needed

  async function load() {
    try {
      setLoading(true);
      const data = await listCartons({ activeOnly: !showInactive });
      // normalize and attach key
      const normalized = data.map((r) => ({
        key: get(r, "id", "ID"),
        id: get(r, "id", "ID"),
        name: get(r, "name", "Name"),
        length_in: get(r, "length_in", "Length_in"),
        width_in: get(r, "width_in", "Width_in"),
        height_in: get(r, "height_in", "Height_in"),
        max_weight_lb: get(r, "max_weight_lb", "max_weight_lb"),
        style: get(r, "style", "Style"),
        vendor: get(r, "vendor", "Vendor"),
        quantity_on_hand: get(r, "quantity_on_hand", "Quantity_on_hand"),
        minimum_stock: get(r, "minimum_stock", "Minimum_stock"),
        active: get(r, "active", "Active"),
      }));
      setRows(normalized);
      setErr(null);
    } catch (e) {
      setErr(e.message || "Failed to load cartons");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [showInactive]);

  // search by name/vendor/style
  useEffect(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return setFiltered(rows);
    setFiltered(
      rows.filter((r) =>
        [r.name, r.vendor, r.style].some((v) => toStr(v).toLowerCase().includes(ql))
      )
    );
  }, [q, rows]);

  // columns (sortable everywhere), sticky header, no pagination, low-stock highlight
  const columns = [
    { title: "Name", dataIndex: "name", width: 220, sorter: (a, b) => toStr(a.name).localeCompare(toStr(b.name)) },
    { title: "L (in)", dataIndex: "length_in", width: 100, sorter: (a, b) => toNum(a.length_in) - toNum(b.length_in), align: "right" },
    { title: "W (in)", dataIndex: "width_in", width: 100, sorter: (a, b) => toNum(a.width_in) - toNum(b.width_in), align: "right" },
    { title: "H (in)", dataIndex: "height_in", width: 100, sorter: (a, b) => toNum(a.height_in) - toNum(b.height_in), align: "right" },
    { title: "Max Wt (lb)", dataIndex: "max_weight_lb", width: 130, sorter: (a, b) => toNum(a.max_weight_lb) - toNum(b.max_weight_lb), align: "right" },
    { title: "Style", dataIndex: "style", width: 110, sorter: (a, b) => toStr(a.style).localeCompare(toStr(b.style)) },
    { title: "Vendor", dataIndex: "vendor", width: 140, sorter: (a, b) => toStr(a.vendor).localeCompare(toStr(b.vendor)) },
    {
      title: "On Hand",
      dataIndex: "quantity_on_hand",
      width: 120,
      sorter: (a, b) => toNum(a.quantity_on_hand) - toNum(b.quantity_on_hand),
      align: "right",
      render: (v, r) => {
        const low = Number(v ?? 0) <= Number(r.minimum_stock ?? 0);
        return <span style={low ? { backgroundColor: "#ffe6e6", padding: "0 6px", borderRadius: 4 } : undefined}>{v}</span>;
      }
    },
    { title: "Min Stock", dataIndex: "minimum_stock", width: 120, sorter: (a, b) => toNum(a.minimum_stock) - toNum(b.minimum_stock), align: "right" },
    {
      title: "Active",
      dataIndex: "active",
      width: 100,
      sorter: (a, b) => Number(Boolean(a.active)) - Number(Boolean(b.active)),
      render: (v) => <Text>{v ? "Yes" : "No"}</Text>
    },
  ];

  // handlers
  const onRowSelect = (sel) => setSelected(sel?.[0] ?? null);

  const openNew = () => {
    form.resetFields();
    form.setFieldsValue({ max_weight_lb: 40, minimum_stock: 0, active: true });
    setEditOpen(true);
  };

  const openEdit = () => {
    if (!selected) return message.info("Select a row first.");
    form.resetFields();
    form.setFieldsValue(selected);
    setEditOpen(true);
  };

  const openAdjust = () => {
    if (!selected) return message.info("Select a row first.");
    adjustForm.resetFields();
    adjustForm.setFieldsValue({ delta: 0 });
    setAdjustOpen(true);
  };

  const submitEdit = async () => {
    const values = await form.validateFields();
    // coerce empty strings to null where appropriate
    const payload = {
      name: values.name || null,
      style: values.style || null,
      vendor: values.vendor || null,
      length_in: values.length_in ?? null,
      width_in: values.width_in ?? null,
      height_in: values.height_in ?? null,
      max_weight_lb: values.max_weight_lb ?? 40,
      minimum_stock: values.minimum_stock ?? 0,
      active: Boolean(values.active),
    };
    try {
      if (selected?.id) {
        await updateCarton(selected.id, payload);
        message.success("Saved");
      } else {
        await createCarton(payload);
        message.success("Created");
      }
      setEditOpen(false);
      await load();
    } catch (e) {
      message.error(String(e?.message || e));
    }
  };

  const submitAdjust = async () => {
    const { delta } = await adjustForm.validateFields();
    try {
      await adjustInventory(selected.id, Number(delta || 0));
      setAdjustOpen(false);
      message.success("Inventory updated");
      await load();
    } catch (e) {
      message.error(String(e?.message || e));
    }
  };

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Title level={4} style={{ margin: 0 }}>Carton Catalog</Title>
        <Space>
          <Button type="primary" onClick={openNew}>New Box Size</Button>
          <Button onClick={openEdit}>Edit</Button>
          <Button onClick={openAdjust}>Adjust Inventory</Button>
        </Space>
        <Space style={{ marginLeft: "auto" }}>
          <Input
            placeholder="Search name/vendor/style…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            allowClear
            style={{ width: 280 }}
          />
          <span>
            <Switch checked={showInactive} onChange={setShowInactive} />{" "}
            <Text type="secondary">Show inactive</Text>
          </span>
        </Space>
      </div>

      {err && <Alert type="error" message="Error" description={err} style={{ marginBottom: 12 }} />}

      {/* Table */}
      <Table
        rowSelection={{
          type: "radio",
          onChange: (_, selectedRows) => onRowSelect(selectedRows),
        }}
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        sticky
        scroll={{ x: 1200, y: tableHeight }}
        pagination={false}
        bordered
        onRow={(record) => ({
          onClick: () => setSelected(record),
        })}
      />

      {/* New/Edit dialog */}
      <Modal
        title={selected?.id ? "Edit Box" : "New Box"}
        open={editOpen}
        onOk={submitEdit}
        onCancel={() => setEditOpen(false)}
        okText="Save"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name"><Input /></Form.Item>
          <Form.Item name="style" label="Style (e.g., FOL, FOSC)"><Input /></Form.Item>
          <Form.Item name="vendor" label="Vendor"><Input /></Form.Item>
          <Form.Item name="length_in" label="Length (in)"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="width_in" label="Width (in)"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="height_in" label="Height (in)"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="max_weight_lb" label="Max Weight (lb)"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="minimum_stock" label="Minimum Stock"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="active" valuePropName="checked"><Checkbox>Active</Checkbox></Form.Item>
        </Form>
      </Modal>

      {/* Adjust Inventory dialog */}
      <Modal
        title={selected ? `Adjust Inventory — ${selected.name ?? "(no name)"}` : "Adjust Inventory"}
        open={adjustOpen}
        onOk={submitAdjust}
        onCancel={() => setAdjustOpen(false)}
        okText="Apply"
        destroyOnHidden
      >
        <Form form={adjustForm} layout="vertical">
          <Form.Item name="delta" label="Change (e.g., +10 or -5)" rules={[{ required: true, message: "Enter a number" }]}>
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

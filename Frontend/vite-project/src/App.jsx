import React, { useMemo, useState } from "react";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AppstoreOutlined,
  InboxOutlined,
  ProfileOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, theme, Typography } from "antd";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
  Navigate,
} from "react-router-dom";

import Packs from "./pages/Packs";
import Orders from "./pages/Orders";
import Cartons from "./pages/Cartons";
import dayusMark from "./assets/dayus-mark.png";
import dayusLogo from "./assets/dayus-logo.svg";

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

const SIDEBAR_WIDTH = 220;
const SIDEBAR_COLLAPSED = 64;
// Change this to whatever brand color you want:
const SIDEBAR_BG = "#F7F7F7"; // custom Sider background (deep navy)

function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  const { pathname } = useLocation();

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/orders")) return "orders";
    if (pathname.startsWith("/cartons")) return "cartons";
    return "packs";
  }, [pathname]);

  const items = [
    { key: "packs", icon: <InboxOutlined />, label: <Link to="/packs">Packs</Link> },
    { key: "orders", icon: <ProfileOutlined />, label: <Link to="/orders">Orders</Link> },
    { key: "cartons", icon: <AppstoreOutlined />, label: <Link to="/cartons">Cartons</Link> },
  ];

  return (
    <Layout style={{ minHeight: "100vh", background: colorBgContainer }}>
      {/* FIXED SIDER */}
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={SIDEBAR_WIDTH}
        collapsedWidth={SIDEBAR_COLLAPSED}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          height: "100vh",
          overflow: "auto",
          background: SIDEBAR_BG, // custom background color
        }}
      >
        {/* Logo row */}
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            paddingInline: collapsed ? 0 : 16,
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            color: "white",
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
          title="Dayus Packaging"
        >
          {collapsed ? (
            <img
              src={dayusMark}
              alt="Dayus"
              style={{ display: "block", width: 42, height: 42, objectFit: "contain" }}
            />
          ) : (
            <img
              src={dayusLogo}
              alt="Dayus Packaging"
              style={{
                display: "block",
                height: 28,          // keeps header row tidy
                maxWidth: 160,       // fits within 220px sider (with 16px padding)
                objectFit: "contain"
              }}
            />
          )}
        </div>


        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          style={{
            background: "transparent", // let the custom Sider color show through
            borderRight: "none",
          }}
        />
      </Sider>

      {/* MAIN AREA SHIFTED RIGHT */}
      <Layout
        style={{
          marginLeft: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH,
          transition: "margin-left 0.2s ease",
          minHeight: "100vh",
        }}
      >
        <Header
          style={{
            padding: 0,
            background: colorBgContainer,
            display: "flex",
            alignItems: "center",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((v) => !v)}
            style={{ fontSize: 16, width: 64, height: 64 }}
          />
          <Title level={4} style={{ margin: 0 }}>
            Packaging App
          </Title>
        </Header>

        <Content
          style={{
            margin: "24px 16px",
            padding: 24,
            minHeight: 280,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/packs" replace />} />
            <Route path="/packs" element={<Packs />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/cartons" element={<Cartons />} />
            <Route path="*" element={<Navigate to="/packs" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <Router>
      <Shell />
    </Router>
  );
}

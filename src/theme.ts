import type { ThemeConfig } from "antd";

export const theme: ThemeConfig = {
  token: {
    colorPrimary: "#237864",
    colorInfo: "#237864",
    colorSuccess: "#237864",
    colorText: "#252b32",
    colorTextSecondary: "#65707c",
    colorBorder: "#dce1e5",
    colorBgLayout: "#f5f6f8",
    borderRadius: 8,
    controlHeight: 38,
    fontSize: 14,
    fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
    boxShadow: "0 6px 24px rgba(24, 39, 35, 0.08)",
  },
  components: {
    Button: { primaryShadow: "none", fontWeight: 500 },
    Menu: {
      itemHeight: 44,
      itemMarginBlock: 5,
      itemBorderRadius: 8,
      itemSelectedBg: "#eaf3ef",
      itemSelectedColor: "#1c6a57",
      itemColor: "#626c77",
      iconSize: 19,
    },
    Modal: { borderRadiusLG: 14, titleFontSize: 18 },
    Card: { borderRadiusLG: 12 },
    Select: { optionSelectedBg: "#eaf3ef" },
  },
};

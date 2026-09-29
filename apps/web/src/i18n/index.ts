import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import vi from "./vi.json";

/** NFR-10: tiếng Việt mặc định, tiếng Anh. Khởi tạo đồng bộ để render tĩnh lúc build. */
if (!i18n.isInitialized) {
	i18n.use(initReactI18next).init({
		resources: { vi: { translation: vi }, en: { translation: en } },
		lng: "vi",
		fallbackLng: "vi",
		interpolation: { escapeValue: false },
		initAsync: false,
	});
}

export default i18n;

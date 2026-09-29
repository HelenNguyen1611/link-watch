import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";

/** UI is English only. Initialised synchronously so pages render during the static build. */
if (!i18n.isInitialized) {
	i18n.use(initReactI18next).init({
		resources: { en: { translation: en } },
		lng: "en",
		fallbackLng: "en",
		interpolation: { escapeValue: false },
		initAsync: false,
	});
}

export default i18n;

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import it from "./locales/it.json";
import en from "./locales/en.json";

const saved = localStorage.getItem("lifetrack_lang");
const browserLang = (navigator.language || "it").toLowerCase().startsWith("it") ? "it" : "en";
const initialLang = saved || browserLang;

i18n.use(initReactI18next).init({
  resources: {
    it: { translation: it },
    en: { translation: en },
  },
  lng: initialLang,
  fallbackLng: "it",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem("lifetrack_lang", lng);
});

export default i18n;

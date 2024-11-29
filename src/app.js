"use strict";

//JS
import { d2Get, d2PutJson } from "./js/d2api.js";
import M from "materialize-css";

//CSS
import "./css/header.css";
import "./css/style.css";
import "materialize-css/dist/css/materialize.min.css";

async function fetchTranslatableObjectTypes() {
    const response = await d2Get("/api/schemas.json?fields=plural,translatable");
    return response.schemas.filter(schema => schema.translatable);
}

async function fetchObjectData(objectType) {
    try {
        const response = await d2Get(`/api/${objectType.plural}?fields=name,id,translations`);
        return response[objectType.plural];
    } catch (error) {
        console.error(`Failed to fetch ${objectType.plural}:`, error);
        return []; // Return an empty array if there is an error
    }
}

function checkForDuplicateTranslations(translations) {
    const seen = {};
    const duplicates = [];

    translations.forEach(translation => {
        const key = `${translation.locale}-${translation.property}`;
        if (!seen[key]) {
            seen[key] = [];
        }
        seen[key].push(translation);
    });

    Object.keys(seen).forEach(key => {
        if (seen[key].length > 1) {
            duplicates.push({
                locale: seen[key][0].locale,
                property: seen[key][0].property,
                values: seen[key].map(t => t.value),
            });
        }
    });

    return duplicates;
}

async function handleFixSelected(selectedDuplicates, setDuplicates) {
    const success = [];
    const failures = [];

    const groupedByObject = selectedDuplicates.reduce((acc, item) => {
        if (!acc[item.id]) {
            acc[item.id] = [];
        }
        acc[item.id].push(item);
        return acc;
    }, {});

    for (const [id, items] of Object.entries(groupedByObject)) {
        try {
            const original = await d2Get(`/api/${items[0].type}/${id}?fields=:owner`);
            const updatedTranslations = original.translations.filter(t => {
                return !items.some(item => item.duplicateKeys.has(`${t.locale}-${t.property}`));
            });
            items.forEach(item => {
                item.translations.forEach(trans => {
                    if (trans.selectedValue !== null) {
                        updatedTranslations.push({
                            locale: item.locale,
                            property: item.property,
                            value: trans.selectedValue,
                        });
                    }
                });
            });

            original.translations = updatedTranslations;

            const endpoint = `/api/${items[0].type}/${id}`;
            await d2PutJson(endpoint, original);
            success.push(...items);
        } catch (error) {
            console.log(error);
            failures.push(...items);
        }
    }

    alert(`${success.length} translation strings updated successfully. ${failures.length} updates failed.`);

    setDuplicates(prevDuplicates =>
        prevDuplicates.filter(duplicate => !success.includes(duplicate))
    );
}

function createTableRow(item, handleRadioChange, handleCheckboxChange, selectedDuplicates) {
    const row = document.createElement("tr");
    const checkboxCell = document.createElement("td");
    const checkbox = document.createElement("label");
    checkbox.innerHTML = `<input type="checkbox" ${selectedDuplicates.includes(item.id) ? "checked" : ""} /><span></span>`;
    checkbox.querySelector("input").addEventListener("change", () => handleCheckboxChange(item.id));
    checkboxCell.appendChild(checkbox);
    row.appendChild(checkboxCell);

    const typeCell = document.createElement("td");
    typeCell.textContent = item.type;
    row.appendChild(typeCell);

    const idCell = document.createElement("td");
    idCell.textContent = item.id;
    row.appendChild(idCell);

    const nameCell = document.createElement("td");
    nameCell.textContent = item.name;
    row.appendChild(nameCell);

    const localeCell = document.createElement("td");
    localeCell.textContent = item.locale;
    row.appendChild(localeCell);

    const propertyCell = document.createElement("td");
    propertyCell.textContent = item.property;
    row.appendChild(propertyCell);

    const translationsCell = document.createElement("td");
    item.translations.forEach(t => {
        const radio = document.createElement("label");
        radio.innerHTML = `<input name="${item.id}-${item.locale}-${item.property}" type="radio" ${t.selectedValue === t.value ? "checked" : ""} /><span>${t.value}</span>`;
        radio.querySelector("input").addEventListener("change", () => handleRadioChange(item, t.key, t.value));
        translationsCell.appendChild(radio);
    });
    row.appendChild(translationsCell);

    return row;
}

function renderApp(duplicates, selectedDuplicates, handleRadioChange, handleCheckboxChange, handleFixSelected) {
    const root = document.getElementById("root");
    root.innerHTML = "";

    if (duplicates.length === 0) {
        root.innerHTML = "<div class='container'>No duplicate translations found.</div>";
        return;
    }

    const container = document.createElement("div");
    container.className = "container";

    const title = document.createElement("h1");
    title.textContent = "Translation Duplicate Fixer";
    container.appendChild(title);

    const table = document.createElement("table");
    table.className = "striped";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["", "Object Type", "ID", "Name", "Locale", "Property", "Translations"].forEach(text => {
        const th = document.createElement("th");
        th.textContent = text;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    duplicates.forEach(item => {
        const row = createTableRow(item, handleRadioChange, handleCheckboxChange, selectedDuplicates);
        tbody.appendChild(row);
    });
    table.appendChild(tbody);

    container.appendChild(table);

    const fixButton = document.createElement("button");
    fixButton.className = "btn";
    fixButton.textContent = "Fix Selected";
    fixButton.addEventListener("click", () => handleFixSelected(duplicates.filter(item => selectedDuplicates.includes(item.id)), setDuplicates));
    container.appendChild(fixButton);

    root.appendChild(container);
}

function initApp() {
    let duplicates = [];
    let selectedDuplicates = [];

    const setDuplicates = (newDuplicates) => {
        duplicates = newDuplicates;
        renderApp(duplicates, selectedDuplicates, handleRadioChange, handleCheckboxChange, handleFixSelected);
    };

    const handleRadioChange = (item, key, value) => {
        const updated = item.translations.map(trans => ({
            ...trans,
            selectedValue: trans.key === key ? value : null,
        }));
        setDuplicates(duplicates.map(dup => (dup.id === item.id && dup.locale === item.locale && dup.property === item.property)
            ? { ...item, translations: updated }
            : dup));
    };

    const handleCheckboxChange = (id) => {
        selectedDuplicates = selectedDuplicates.includes(id)
            ? selectedDuplicates.filter(duplicate => duplicate !== id)
            : [...selectedDuplicates, id];
        renderApp(duplicates, selectedDuplicates, handleRadioChange, handleCheckboxChange, handleFixSelected);
    };

    const handleFixSelected = async (selectedItems, setDuplicates) => {
        await handleFixSelected(selectedItems, setDuplicates);
    };

    (async function init() {
        const types = await fetchTranslatableObjectTypes();
        const dupeList = [];

        for (const type of types) {
            const objects = await fetchObjectData(type);
            objects.forEach(obj => {
                const duplicatedTranslations = checkForDuplicateTranslations(obj.translations);
                if (duplicatedTranslations.length > 0) {
                    const duplicateKeys = new Set(duplicatedTranslations.map(dup => `${dup.locale}-${dup.property}`));
                    duplicatedTranslations.forEach(dup => {
                        const relevantTranslations = obj.translations.filter(t => t.locale === dup.locale && t.property === dup.property);
                        const translations = relevantTranslations.map((t, i) => ({
                            key: `${t.locale}-${t.property}-${t.value}`,
                            value: t.value,
                            selectedValue: i === 0 ? t.value : null
                        }));
                        dupeList.push({
                            type: type.plural,
                            id: obj.id,
                            name: obj.name,
                            locale: dup.locale,
                            property: dup.property,
                            translations: translations,
                            originalTranslations: obj.translations,
                            duplicateKeys: duplicateKeys // store duplicate keys for filtering
                        });
                    });
                }
            });
        }

        setDuplicates(dupeList);
    })();
}

document.addEventListener("DOMContentLoaded", initApp);
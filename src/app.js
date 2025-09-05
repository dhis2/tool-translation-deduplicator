"use strict";

// JS Imports
import { d2Get, d2PutJson } from "./js/d2api.js";
import { loadLegacyHeaderBarIfNeeded } from "./js/check-header-bar.js";
import M from "materialize-css";

// CSS Imports
import "./css/style.css";
import "materialize-css/dist/css/materialize.min.css";

// Global state
let duplicates = [];
let selectedDuplicates = [];


// Fetch and filter translatable object types
async function fetchTranslatableObjectTypes() {
    const response = await d2Get("api/schemas.json?fields=plural,translatable,relativeApiEndpoint&filter=translatable:eq:true");
    return response.schemas.filter(schema => schema.translatable);
}


// Fetch object data for a given type
async function fetchObjectData(objectType) {
    try {
        const response = await d2Get(`/api/${objectType.plural}?fields=name,id,translations`);
        return response[objectType.plural];
    } catch (error) {
        console.error(`Failed to fetch ${objectType.plural}:`, error);
        return [];  // Return empty array if there's an error
    }
}


// Check for duplicate translations within a list
function checkForDuplicateTranslations(translations) {
    const seen = new Map();
    const duplicates = [];

    translations.forEach(translation => {
        const key = `${translation.locale}-${translation.property}`;
        if (seen.has(key)) {
            seen.get(key).push(translation);
        } else {
            seen.set(key, [translation]);
        }
    });

    seen.forEach((translations) => {
        if (translations.length > 1) {
            duplicates.push({
                locale: translations[0].locale,
                property: translations[0].property,
                values: translations.map(t => t.value),
            });
        }
    });

    return duplicates;
}


// Handle the selection of translations to fix and update via DHIS2 API
async function fixSelectedTranslations(selectedItems) {
    const success = [];
    const failures = [];

    const groupedByObject = selectedItems.reduce((acc, item) => {
        acc[item.id] = acc[item.id] || [];
        acc[item.id].push(item);
        return acc;
    }, {});

    for (const [id, items] of Object.entries(groupedByObject)) {
        try {
            const original = await d2Get(`/api/${items[0].type}/${id}?fields=:owner`);
            const updatedTranslations = original.translations.filter(t =>
                !items.some(item => item.duplicateKeys.has(`${t.locale}-${t.property}`))
            );

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
            console.error(error);
            failures.push(...items);
        }
    }

    if (success.length > 0) {
        M.toast({html: `${success.length} translation strings updated successfully.`, classes: "rounded"});
    }
    if (failures.length > 0) {
        M.toast({html: `${failures.length} updates failed.`, classes: "rounded"});
    }

    // Update the duplicates state and re-render the table
    duplicates = duplicates.filter(duplicate => !success.includes(duplicate));
    renderTable();
}


// Handle radio button selection for translations
function handleRadioChange(item, key, value) {
    const updatedTranslations = item.translations.map(trans => 
        ({ ...trans, selectedValue: trans.key === key ? value : null })
    );
    duplicates = duplicates.map(dup =>
        (dup.id === item.id && dup.locale === item.locale && dup.property === item.property)
            ? { ...item, translations: updatedTranslations }
            : dup
    );
    renderTable();
}


// Handle checkbox selection for duplicates
function handleCheckboxChange(id) {
    if (selectedDuplicates.includes(id)) {
        selectedDuplicates = selectedDuplicates.filter(duplicateId => duplicateId !== id);
    } else {
        selectedDuplicates.push(id);
    }
    renderTable();
}


// Create table row for each duplicate item
function createTableRow(item, rowspan) {
    const row = document.createElement("tr");

    // Select individual row checkbox
    if (rowspan > 0) {
        const checkboxCell = document.createElement("td");
        const checkbox = document.createElement("label");
        checkbox.innerHTML = `<input type="checkbox" ${selectedDuplicates.includes(item.id) ? "checked" : ""} /><span></span>`;
        checkbox.querySelector("input").addEventListener("change", () => handleCheckboxChange(item.id));
        checkboxCell.appendChild(checkbox);
        checkboxCell.rowSpan = rowspan;
        row.appendChild(checkboxCell);
    }

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


// Render the table with duplicates and selection handlers
function renderTable() {
    const root = document.getElementById("root");
    root.innerHTML = "";

    if (duplicates.length === 0) {
        M.toast({ html: "No duplicate translations found.", classes: "rounded" });
        return;
    }

    const table = document.createElement("table");
    table.className = "striped";
    table.style.width = "100%";
    table.style.padding = "10px";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    // "Select All" Checkbox
    const selectAllCheckboxCell = document.createElement("th");
    const selectAllCheckbox = document.createElement("label");
    const isAllSelected = duplicates.length > 0 && selectedDuplicates.length === duplicates.length;
    selectAllCheckbox.innerHTML = `<input type="checkbox" ${isAllSelected ? "checked" : ""} /><span></span>`;
    selectAllCheckbox.querySelector("input").addEventListener("change", (event) => {
        const isChecked = event.target.checked;
        selectedDuplicates = isChecked ? duplicates.map(dup => dup.id) : [];
        renderTable();
    });
    selectAllCheckboxCell.appendChild(selectAllCheckbox);
    headerRow.appendChild(selectAllCheckboxCell);

    ["Object Type", "ID", "Name", "Locale", "Property", "Translations"].forEach(text => {
        const th = document.createElement("th");
        th.textContent = text;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const groupedByObject = duplicates.reduce((acc, item) => {
        acc[item.id] = acc[item.id] || [];
        acc[item.id].push(item);
        return acc;
    }, {});

    Object.values(groupedByObject).forEach(group => {
        group.forEach((item, index) => {
            const row = createTableRow(item, index === 0 ? group.length : 0);
            tbody.appendChild(row);
        });
    });
    table.appendChild(tbody);

    root.appendChild(table);

    const fixButton = document.createElement("button");
    fixButton.className = "btn";
    fixButton.textContent = "Fix Selected";
    fixButton.addEventListener("click", () => fixSelectedTranslations(duplicates.filter(item => selectedDuplicates.includes(item.id))));
    root.appendChild(fixButton);
}


// Display loading indicator during data fetching
function renderPreloader(progress) {
    const root = document.getElementById("root");
    root.innerHTML = `
        <div class="progress">
            <div class="determinate" style="width: ${progress}%"></div>
        </div>
    `;
}


// Initial data load and processing
async function loadData() {
    const types = await fetchTranslatableObjectTypes();
    const dupeList = [];

    for (const type of types) {
        const objects = await fetchObjectData(type);
        for (const obj of objects) {
            const duplicatedTranslations = checkForDuplicateTranslations(obj.translations);
            if (duplicatedTranslations.length > 0) {
                const duplicateKeys = new Set(duplicatedTranslations.map(dup => `${dup.locale}-${dup.property}`));
                for (const dup of duplicatedTranslations) {
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
                }
            }
        }
        const progress = ((types.indexOf(type) + 1) / types.length) * 100;
        renderPreloader(progress);
    }

    duplicates = dupeList;
    renderTable();
}


// Add event listener for DOM content loaded to kick off data loading
document.addEventListener("DOMContentLoaded", loadData);


// Make key functions available on the window object
window.fixSelectedTranslations = fixSelectedTranslations;
window.renderTable = renderTable;

loadLegacyHeaderBarIfNeeded();
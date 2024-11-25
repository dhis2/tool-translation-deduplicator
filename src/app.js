"use strict";

//JS
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { Button, Table, TableHead, TableRow, TableCell, TableBody, Checkbox, Radio } from "@material-ui/core";
import { d2Get, d2PutJson } from "./js/d2api.js";

//CSS
import "./css/header.css";
import "./css/style.css";


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
                const key = `${t.locale}-${t.property}`;
                return !items.some(item => item.translations.some(d => d.key === key && d.selectedValue !== t.value));
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

    alert(`${success.length} objects updated successfully. ${failures.length} updates failed.`);

    setDuplicates(prevDuplicates =>
        prevDuplicates.filter(duplicate => !success.includes(duplicate))
    );
}

function TranslationsApp() {
    const [duplicates, setDuplicates] = useState([]);
    const [selectedDuplicates, setSelectedDuplicates] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function init() {
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
            setIsLoading(false);
        }
        init();
    }, []);

    const handleRadioChange = (item, key, value) => {
        const updated = item.translations.map(trans => ({
            ...trans,
            selectedValue: trans.key === key ? value : null,
        }));
        setDuplicates(prevDuplicates =>
            prevDuplicates.map(dup => (dup.id === item.id && dup.locale === item.locale && dup.property === item.property)
                ? { ...item, translations: updated }
                : dup)
        );
    };

    const handleCheckboxChange = (id) => {
        setSelectedDuplicates(prevSelected => {
            if (prevSelected.includes(id)) {
                return prevSelected.filter(duplicate => duplicate !== id);
            } else {
                return [...prevSelected, id];
            }
        });
    };

    if (isLoading) {
        return React.createElement("div", null, "Loading...");
    }

    if (duplicates.length === 0) {
        return React.createElement("div", { className: "container" }, "No duplicate translations found.");
    }

    const selectedItems = duplicates.filter(item => selectedDuplicates.includes(item.id));

    return React.createElement(
        "div",
        { className: "container" },
        React.createElement("h1", null, "Translation Duplicate Fixer"),
        React.createElement(
            Table,
            { className: "table" },
            React.createElement(
                TableHead,
                null,
                React.createElement(
                    TableRow,
                    null,
                    React.createElement(TableCell, null, React.createElement(Checkbox, { onChange: (event) => setSelectedDuplicates(event.target.checked ? duplicates.map(dup => dup.id) : []) })),
                    React.createElement(TableCell, null, "Object Type"),
                    React.createElement(TableCell, null, "ID"),
                    React.createElement(TableCell, null, "Name"),
                    React.createElement(TableCell, null, "Locale"),
                    React.createElement(TableCell, null, "Property"),
                    React.createElement(TableCell, null, "Translations")
                )
            ),
            React.createElement(
                TableBody,
                null,
                duplicates.reduce((acc, item, index, arr) => {
                    const sameObjectGroup = arr.filter(dup => dup.id === item.id);
                    const isFirstInGroup = item === sameObjectGroup[0];

                    acc.push(
                        React.createElement(
                            TableRow,
                            { key: `${item.id}-${item.locale}-${item.property}` },
                            isFirstInGroup && React.createElement(TableCell, { rowSpan: sameObjectGroup.length }, React.createElement(Checkbox, { checked: selectedDuplicates.includes(item.id), onChange: () => handleCheckboxChange(item.id) })),
                            isFirstInGroup && React.createElement(TableCell, { rowSpan: sameObjectGroup.length }, item.type),
                            isFirstInGroup && React.createElement(TableCell, { rowSpan: sameObjectGroup.length }, item.id),
                            isFirstInGroup && React.createElement(TableCell, { rowSpan: sameObjectGroup.length }, item.name),
                            React.createElement(TableCell, null, item.locale),
                            React.createElement(TableCell, null, item.property),
                            React.createElement(
                                TableCell,
                                null,
                                item.translations.map(t =>
                                    React.createElement(
                                        "div",
                                        { key: t.key },
                                        React.createElement(Radio, {
                                            checked: t.selectedValue === t.value,
                                            onChange: () => handleRadioChange(item, t.key, t.value)
                                        }),
                                        t.value
                                    )
                                )
                            )
                        )
                    );

                    return acc;
                }, [])
            )
        ),
        React.createElement(Button, { onClick: () => handleFixSelected(selectedItems, setDuplicates) }, "Fix Selected")
    );
}

ReactDOM.render(React.createElement(TranslationsApp, null), document.getElementById("root"));
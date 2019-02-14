import React, { Component } from "react";
import logo from "./logo.svg";
import "./App.css";
import FileDrop from "react-file-drop";
import XLSX from "xlsx";
import { uniq } from "lodash";
const chrono = require("chrono-node");

const READ_AS_BINARY_STRING = false;

const DATE_REGEX_PART = ".*(date|dt|decade|year).*";
const DATE_REGEX = new RegExp(DATE_REGEX_PART, "i");
const START_DATE_REGEX = new RegExp(".*(start|st)" + DATE_REGEX_PART, "i");
const END_DATE_REGEX = new RegExp(".*(end)" + DATE_REGEX_PART, "i");
const EARLIEST_POSSIBLE_MOMENT = new Date(-8640000000000000);
const LATEST_POSSIBLE_MOMENT = new Date(8640000000000000);

function tryFilterHeaders(headers: string[], ...regexes: RegExp[]) {
    for (const thisRegex of regexes) {
        const matchingHeaders = headers.filter(header =>
            thisRegex.test(header)
        );

        if (matchingHeaders.length > 0) {
            return matchingHeaders;
        }
    }

    return [];
}

function preferYears(chronoOutput: any) {
    if (
        !chronoOutput.knownValues.year &&
        typeof chronoOutput.knownValues.hour !== "undefined" &&
        typeof chronoOutput.knownValues.minute !== "undefined"
    ) {
        chronoOutput.knownValues.year =
            chronoOutput.knownValues.hour.toString().padStart(2, "0") +
            chronoOutput.knownValues.minute.toString().padStart(2, "0");
        chronoOutput.knownValues.hour = undefined;
        chronoOutput.knownValues.minute = undefined;

        console.log(chronoOutput);
    }

    return chronoOutput;
}

function pickMoment(
    rawDate: string,
    toCompare: Date,
    getBetter: (moment1: Date, moment2: Date) => Date
) {
    const parsed: Array<any> =
        rawDate && rawDate.length > 0 && chrono.strict.parse(rawDate);

    if (parsed && parsed.length > 0 && parsed[0].start) {
        const startDate = preferYears(parsed[0].start).date();

        const betterDate = parsed[0].end
            ? getBetter(startDate, preferYears(parsed[0].end).date())
            : startDate;

        return getBetter(betterDate, toCompare);
    } else {
        return toCompare;
    }
}

type DateAggregation = {
    earliestStart: Date;
    latestEnd: Date;
};

class App extends Component {
    state = {
        dates: undefined,
        loading: false
    } as {
        dates?: DateAggregation;
        loading: boolean;
        error?: Error;
    };

    onDrop = (fileList: FileList, event: React.DragEvent<HTMLDivElement>) => {
        const files = event.dataTransfer.files;
        const f = files[0];
        const reader = new FileReader();

        this.setState({
            loading: true,
            dateAgg: undefined
        });

        reader.onload = e => {
            if (!e.target) {
                throw new Error("No target for event");
            }

            try {
                const data = !READ_AS_BINARY_STRING
                    ? new Uint8Array((e.target as any).result)
                    : (e.target as any).result;
                const workbook = XLSX.read(data, {
                    type: READ_AS_BINARY_STRING ? "binary" : "array"
                });

                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(worksheet);

                if (!rows.length) {
                    throw new Error("Empty");
                }

                const rowOne = rows[0];
                const headers = Object.keys(rowOne);

                const startDateHeaders = tryFilterHeaders(
                    headers,
                    START_DATE_REGEX
                );
                const endDateHeaders = tryFilterHeaders(
                    headers,
                    END_DATE_REGEX
                );
                const dateHeaders = tryFilterHeaders(headers, DATE_REGEX);

                const startDateHeadersInOrder = uniq(
                    startDateHeaders.concat(dateHeaders).concat(endDateHeaders)
                );
                const endDateHeadersInOrder = uniq(
                    endDateHeaders.concat(dateHeaders).concat(startDateHeaders)
                );

                console.log(
                    "Start Date Headers: " +
                        JSON.stringify(startDateHeadersInOrder)
                );
                console.log(
                    "End Date Headers: " + JSON.stringify(endDateHeadersInOrder)
                );

                if (
                    startDateHeadersInOrder.length === 0 ||
                    endDateHeadersInOrder.length === 0
                ) {
                    throw new Error("Could not find date headers");
                }

                const dateAgg = rows.reduce(
                    (soFar: DateAggregation, row: any) => {
                        return {
                            earliestStart: startDateHeadersInOrder.reduce(
                                (earliestStart: Date, header: string) =>
                                    pickMoment(
                                        row[header],
                                        earliestStart,
                                        (date1, date2) =>
                                            date1.getTime() <= date2.getTime()
                                                ? date1
                                                : date2
                                    ),
                                soFar.earliestStart
                            ),
                            latestEnd: endDateHeadersInOrder.reduce(
                                (latestEnd: Date, header: string) =>
                                    pickMoment(
                                        row[header],
                                        latestEnd,
                                        (date1, date2) =>
                                            date1.getTime() > date2.getTime()
                                                ? date1
                                                : date2
                                    ),
                                soFar.latestEnd
                            )
                        };
                    },
                    {
                        earliestStart: LATEST_POSSIBLE_MOMENT,
                        latestEnd: EARLIEST_POSSIBLE_MOMENT
                    } as DateAggregation
                );

                this.setState({
                    dates: dateAgg,
                    loading: false
                });

                const { earliestStart, latestEnd } = dateAgg;

                console.log(
                    "Earliest start: " +
                        (earliestStart.getTime() ===
                        LATEST_POSSIBLE_MOMENT.getTime()
                            ? "Not found"
                            : earliestStart.toString())
                );
                console.log(
                    "Latest end: " +
                        (latestEnd.getTime() ===
                        EARLIEST_POSSIBLE_MOMENT.getTime()
                            ? "Not found"
                            : latestEnd.toString())
                );
            } catch (e) {
                this.setState({ error: e, loading: false });
                console.error(e);
            }
        };

        if (READ_AS_BINARY_STRING) {
            reader.readAsBinaryString(f);
        } else {
            reader.readAsArrayBuffer(f);
        }
    };

    render() {
        return (
            <div className="App">
                <header className="App-header">
                    <FileDrop onDrop={this.onDrop}>
                        <img src={logo} className="App-logo" alt="logo" />
                    </FileDrop>
                    <p>Drop an excel or a csv on the spinny thing!</p>
                    {this.state.loading && <p>Loading...</p>}
                    {this.state.error && (
                        <p>Error: {this.state.error.toString()}</p>
                    )}
                    {this.state.dates && (
                        <React.Fragment>
                            <p>
                                Earliest date:{" "}
                                {this.state.dates.earliestStart.toString()}
                            </p>
                            <p>
                                Latest date:{" "}
                                {this.state.dates.latestEnd.toString()}
                            </p>
                        </React.Fragment>
                    )}
                    <a
                        className="App-link"
                        href="https://reactjs.org"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Learn React
                    </a>
                </header>
            </div>
        );
    }
}

export default App;

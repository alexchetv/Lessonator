/*
	lessonator 0.0.1
	https://github.com/alexchetv/Lessonator/

	Based on Christopher Giffard Captionator https://github.com/cgiffard/Captionator
*/
/*global HTMLVideoElement: true, NodeList: true, Audio: true, HTMLElement: true, document:true, window:true, XMLHttpRequest:true, navigator:true */
/*jshint strict:true */
/*Tab indented, tab = 4 spaces*/

(function() {
	"use strict";
	
	//	Variables you might want to tweak
	var minimumFontSize = 10;				//	We don't want the type getting any smaller than this.
	var minimumLineHeight = 16;				//	As above, in points
	var fontSizeVerticalPercentage = 4.5;	//	Caption font size is 4.5% of the video height
	var lineHeightRatio = 1.5;				//	Caption line height is 1.3 times the font size
	var phraseBackgroundColour	= [0,0,0,0.5];	//	R,G,B,A
	var objectsCreated = false;				//	We don't want to create objects twice, or instanceof won't work
	
	var lessonator = {
		/*
			Subclassing DOMException so we can reliably throw it without browser intervention. This is quite hacky. See SO post:
			http://stackoverflow.com/questions/5136727/manually-artificially-throwing-a-domexception-with-javascript
		*/
		"createDOMException": function(code,message,name) {
			try {
				//	Deliberately cause a DOMException error
				document.querySelectorAll("div/[]");
			} catch(Error) {
				//	Catch it and subclass it
				/**
				 * @constructor
				 */
				var CustomDOMException = function CustomDOMException(code,message,name){ this.code = code; this.message = message; this.name = name; };
				CustomDOMException.prototype = Error;
				return new CustomDOMException(code,message,name);
			}
		},
		/*
			lessonator.compareArray(array1, array2)
		
			Rough and ready array comparison function we can use to easily determine
			whether phrases have changed or not.
		
			First parameter: The first aray to compare

			Second parameter: The second array to compare
		
			RETURNS:
		
			True if the arrays are the same length and all elements in each array are the strictly equal (index for index.)
			False in all other circumstances.
			Returns false if either parameter is not an instance of Array().
		
		*/
		"compareArray": function compareArray(array1,array2) {
			//	If either of these arguments aren't arrays, we consider them unequal
			if (!(array1 instanceof Array) || !(array2 instanceof Array)) { return false; }
			//	If the lengths are different, we consider then unequal
			if (array1.length !== array2.length) { return false; }
			//	Loop through, break at first value inequality
			for (var index in array1) {
				if (array1.hasOwnProperty(index)) {
					if (array1[index] !== array2[index]) { return false; }
				}
			}
			//	If we haven't broken, they're the same!
			return true;
		},
		/*
			lessonator.generateID([number ID length])
		
			Generates a randomised string prefixed with the word lessonator. This function is used internally to keep track of
			objects and nodes in the DOM.
		
			First parameter: A number of random characters/numbers to generate. This defaults to 10.
		
			RETURNS:
		
			The generated ID string.
		
		*/
		"generateID": function(stringLength) {
			var idComposite = "";
			stringLength = stringLength ? stringLength : 10;
			while (idComposite.length < stringLength) {
				idComposite += String.fromCharCode(65 + Math.floor(Math.random()*26));
			}
		
			return "lessonator" + idComposite;
		},
		/*
			lessonator.lessonify([selector string array | DOMElement array | selector string | singular dom element ],
									[defaultLanguage - string in BCP47],
									[options - JS Object])
		
			Adds closed captions to video elements. The first, second and third parameter are both optional.
		
			First parameter: Use an array of either DOMElements or selector strings (compatible with querySelectorAll.)
			All of these elements will be captioned if lsns are available. If this parameter is omitted, all video elements
			present in the DOM will be captioned if lsns are available.
		
			Second parameter: BCP-47 string for default language. If this parameter is omitted, the User Agent's language
			will be used to choose a lesson.
		
			Third parameter: as yet unused - will implement animation settings and some other global options with this
			parameter later.
		
		
			RETURNS:
		
			False on immediate failure due to input being malformed, otherwise true (even if the process fails later.)
			Because of the asynchronous download requirements, this function can't really return anything meaningful.
		
		
		*/
		"lessonify": function(element,defaultLanguage,options) {
			var videoElements = [], elementIndex = 0;
			options = options instanceof Object? options : {};

			// Override defaults if options are present...
			if (options.minimumFontSize && typeof(options.minimumFontSize) === "number") {
				minimumFontSize = options.minimumFontSize;
			}

			if (options.minimumLineHeight && typeof(options.minimumLineHeight) === "number") {
				minimumLineHeight = options.minimumLineHeight;
			}
			
			if (options.fontSizeVerticalPercentage && typeof(options.fontSizeVerticalPercentage) === "number") {
				fontSizeVerticalPercentage = options.fontSizeVerticalPercentage;
			}
			
			if (options.lineHeightRatio && typeof(options.lineHeightRatio) !== "number") {
				lineHeightRatio = options.lineHeightRatio;
			}

			if (options.phraseBackgroundColour && options.phraseBackgroundColour instanceof Array) {
				phraseBackgroundColour = options.phraseBackgroundColour;
			}
			
			/* Feature detection block */
			if (!HTMLVideoElement) {
				// Browser doesn't support HTML5 video - die here.
				return false;
			}

			if (!objectsCreated) {
				// Set up objects & types
				// As defined by http://www.whatwg.org/specs/web-apps/current-work/multipage/video.html
				/**
				 * @constructor
				 */
				lessonator.TextLsn = function TextLsn(id,kind,label,language,lsnSource,isDefault) {
				
					this.onload = function () {};
					this.onerror = function() {};
					this.onphrasechange = function() {};
				
					this.id = id || "";
					this.internalMode = lessonator.TextLsn.OFF;
					this.phrases = new lessonator.TextLsnPhraseList(this);
					this.activePhrases = new lessonator.ActiveTextLsnPhraseList(this.phrases,this);
					this.kind = kind || "subtitles";
					this.label = label || "";
					this.language = language || "";
					this.src = lsnSource || "";
					this.readyState = lessonator.TextLsn.NONE;
					this.internalDefault = isDefault || false;
				
					// Create getters and setters for mode
					this.getMode = function() {
						return this.internalMode;
					};
				
					this.setMode = function(value) {
						var allowedModes = [lessonator.TextLsn.OFF,lessonator.TextLsn.HIDDEN,lessonator.TextLsn.SHOWING], containerID, container;
						if (allowedModes.indexOf(value) !== -1) {
							if (value !== this.internalMode) {
								this.internalMode = value;
						
								if (this.readyState === lessonator.TextLsn.NONE && this.src.length > 0 && value > lessonator.TextLsn.OFF) {
									this.loadLsn(this.src,null);
								}
								
								// Refresh all captions on video
								this.videoNode._lessonator_dirtyBit = true;
								lessonator.rebuildCaptions(this.videoNode);
							
								if (value === lessonator.TextLsn.OFF) {
									// make sure the resource is reloaded next time (Is this correct behaviour?)
									this.phrases.length = 0; // Destroy existing phrase data (bugfix)
									this.readyState = lessonator.TextLsn.NONE;
								}
							}
						} else {
							throw new Error("Illegal mode value for lsn: " + value);
						}
					};
				
					// Create getter for default
					this.getDefault = function() {
						return this.internalDefault;
					};
				
					if (Object.prototype.__defineGetter__) {
						this.__defineGetter__("mode", this.getMode);
						this.__defineSetter__("mode", this.setMode);
						this.__defineGetter__("default", this.getDefault);
					} else if (Object.defineProperty) {
						Object.defineProperty(this,"mode",
							{get: this.getMode, set: this.setMode}
						);
						Object.defineProperty(this,"default",
							{get: this.getDefault}
						);
					}
				
					this.loadLsn = function(source, callback) {
						var captionData, ajaxObject = new XMLHttpRequest();
						if (this.readyState === lessonator.TextLsn.LOADED) {
							if (callback instanceof Function) {
								callback(captionData);
							}
						} else {
							this.src = source;
							this.readyState = lessonator.TextLsn.LOADING;
						
							var currentLsnElement = this;
							ajaxObject.open('GET', source, true);
							ajaxObject.onreadystatechange = function (eventData) {
								if (ajaxObject.readyState === 4) {
									if(ajaxObject.status === 200) {
										var LsnProcessingOptions = currentLsnElement.videoNode._lessonatorOptions || {};
										if (currentLsnElement.kind === "metadata") {
											// People can load whatever data they please into metadata lsns.
											// Don't process it.
											LsnProcessingOptions.processPhraseHTML = false;
											LsnProcessingOptions.sanitisePhraseHTML = false;
										}
										
										captionData = lessonator.parseCaptions(ajaxObject.responseText,LsnProcessingOptions);
										currentLsnElement.readyState = lessonator.TextLsn.LOADED;
										currentLsnElement.phrases.loadPhrases(captionData);
										currentLsnElement.activePhrases.refreshPhrases.apply(currentLsnElement.activePhrases);
										currentLsnElement.videoNode._lessonator_dirtyBit = true;
										lessonator.rebuildCaptions(currentLsnElement.videoNode);
										currentLsnElement.onload.call(this);
									
										if (callback instanceof Function) {
											callback.call(currentLsnElement,captionData);
										}
									} else {
										// Throw error handler, if defined
										currentLsnElement.readyState = lessonator.TextLsn.ERROR;
										currentLsnElement.onerror();
									}
								}
							};
							try {
								ajaxObject.send(null);
							} catch(Error) {
								// Throw error handler, if defined
								currentLsnElement.readyState = lessonator.TextLsn.ERROR;
								currentLsnElement.onerror(Error);
							}
						}
					};
				
					// mutableTextLsn.addPhrase(phrase)
					// Adds the given phrase to mutableTextLsn's text lsn list of phrases.
					// Raises an exception if the argument is null, associated with another text lsn, or already in the list of phrases.
				
					this.addPhrase = function(phrase) {
						if (phrase && phrase instanceof lessonator.TextLsnPhrase) {
							this.phrases.addPhrase(phrase);
						} else {
							throw new Error("The argument is null or not an instance of TextLsnPhrase.");
						}
					};
				
					// mutableTextLsn.removePhrase(phrase)
					// Removes the given phrase from mutableTextLsn's text lsn list of phrases.
					// Raises an exception if the argument is null, associated with another text lsn, or not in the list of phrases.
				
					this.removePhrase = function() {
					
					};
				};
				// Define constants for TextLsn.readyState
				lessonator.TextLsn.NONE = 0;
				lessonator.TextLsn.LOADING = 1;
				lessonator.TextLsn.LOADED = 2;
				lessonator.TextLsn.ERROR = 3;
				// Define constants for TextLsn.mode
				lessonator.TextLsn.OFF = 0;
				lessonator.TextLsn.HIDDEN = 1;
				lessonator.TextLsn.SHOWING = 2;
			
				// Define read-only properties
				/**
				 * @constructor
				 */
				lessonator.TextLsnPhraseList = function TextLsnPhraseList(lsn) {
					this.lsn = lsn instanceof lessonator.TextLsn ? lsn : null;
				
					this.getPhraseById = function(phraseID) {
						return this.filter(function(currentPhrase) {
							return currentPhrase.id === phraseID;
						})[0];
					};
				
					this.loadPhrases = function(phraseData) {
						for (var phraseIndex = 0; phraseIndex < phraseData.length; phraseIndex ++) {
							phraseData[phraseIndex].lsn = this.lsn;
							Array.prototype.push.call(this,phraseData[phraseIndex]);
						}
					};

					this.addPhrase = function(phrase) {
						if (phrase && phrase instanceof lessonator.TextLsnPhrase) {
							if (phrase.lsn === this.lsn || !phrase.lsn) {
								// TODO: Check whether phrase is already in list of phrases.
								// TODO: Sort phrase list based on TextLsnPhrase.startTime.
								Array.prototype.push.call(this,phrase);
							} else {
								throw new Error("This phrase is associated with a different lsn!");
							}
						} else {
							throw new Error("The argument is null or not an instance of TextLsnPhrase.");
						}
					};
				
					this.toString = function() {
						return "[TextLsnPhraseList]";
					};
				};
				lessonator.TextLsnPhraseList.prototype = [];
			
				/**
				 * @constructor
				 */
				lessonator.ActiveTextLsnPhraseList = function ActiveTextLsnPhraseList(textLsnPhraseList,textLsn) {
					// Among active phrases:
				
					// The text lsn phrases of a media element's text lsns are ordered relative to each
					// other in the text lsn phrase order, which is determined as follows: first group the
					// phrases by their text lsn, with the groups being sorted in the same order as their
					// text lsns appear in the media element's list of text lsns; then, within each
					// group, phrases must be sorted by their start time, earliest first; then, any phrases with
					// the same start time must be sorted by their end time, earliest first; and finally,
					// any phrases with identical end times must be sorted in the order they were created (so
					// e.g. for phrases from a WebVTT file, that would be the order in which the phrases were
					// listed in the file).

					this.refreshPhrases = function() {
						if (textLsnPhraseList.length) {
							var phraseList = this;
							var phraseListChanged = false;
							var oldPhraseList = [].slice.call(this,0);
							this.length = 0;
							
							textLsnPhraseList.forEach(function(phrase) {
								if (phrase.active) {
									phraseList.push(phrase);

									if (phraseList[phraseList.length-1] !== oldPhraseList[phraseList.length-1]) {
										phraseListChanged = true;
									}
								}
							});

							if (phraseListChanged) {
								try {
									textLsn.onphrasechange();
								} catch(error){}
							}
						}
					};
				
					this.toString = function() {
						return "[ActiveTextLsnPhraseList]";
					};
				
					this.refreshPhrases();
				};
				lessonator.ActiveTextLsnPhraseList.prototype = new lessonator.TextLsnPhraseList(null);
			
				/**
				 * @constructor
				 */
				lessonator.TextLsnPhrase = function TextLsnPhrase(id, startTime, endTime, text, settings, pauseOnExit, lsn) {
					// Set up internal data store
					this.id = id;
					this.lsn = lsn instanceof lessonator.TextLsn ? lsn : null;
					this.startTime = parseFloat(startTime);
					this.endTime = parseFloat(endTime);
					this.text = typeof(text) === "string" || text instanceof lessonator.lessonatorPhraseStructure ? text : "";
					this.settings = typeof(settings) === "string" ? settings : "";
					this.intSettings = {};
					this.pauseOnExit = !!pauseOnExit;
					this.wasActive = false;
				
					// Parse settings & set up phrase defaults
				
					// A writing direction, either horizontal (a line extends horizontally and is positioned vertically,
					// with consecutive lines displayed below each other), vertical growing left (a line extends vertically
					// and is positioned horizontally, with consecutive lines displayed to the left of each other), or
					// vertical growing right (a line extends vertically and is positioned horizontally, with consecutive
					// lines displayed to the right of each other).
					// Values:
					// horizontal, vertical, vertical-lr
					this.direction = "horizontal";
				
					// A boolean indicating whether the line's position is a line position (positioned to a multiple of the
					// line dimensions of the first line of the phrase), or whether it is a percentage of the dimension of the video.
					this.snapToLines = true;
				
					// Either a number giving the position of the lines of the phrase, to be interpreted as defined by the
					// writing direction and snap-to-lines flag of the phrase, or the special value auto, which means the
					// position is to depend on the other active lsns.
					this.linePosition = "auto";
				
					// A number giving the position of the text of the phrase within each line, to be interpreted as a percentage
					// of the video, as defined by the writing direction.
					this.textPosition = 50;
				
					// A number giving the size of the box within which the text of each line of the phrase is to be aligned, to
					// be interpreted as a percentage of the video, as defined by the writing direction.
					this.size = 0;
				
					// An alignment for the text of each line of the phrase, either start alignment (the text is aligned towards its
					// start side), middle alignment (the text is aligned centered between its start and end sides), end alignment
					// (the text is aligned towards its end side). Which sides are the start and end sides depends on the
					// Unicode bidirectional algorithm and the writing direction. [BIDI]
					// Values:
					// start, middle, end
					this.alignment = "middle";
				
					// Parse VTT Settings...
					if (this.settings.length) {
						var intSettings = this.intSettings;
						var currentPhrase = this;
						settings = settings.split(/\s+/).filter(function(settingItem) { return settingItem.length > 0;});
						if (settings instanceof Array) {
							settings.forEach(function(phraseItem) {
								var settingMap = {"D":"direction","L":"linePosition","T":"textPosition","A":"alignment","S":"size"};
								phraseItem = phraseItem.split(":");
								if (settingMap[phraseItem[0]]) {
									intSettings[settingMap[phraseItem[0]]] = phraseItem[1];
								}
							
								if (settingMap[phraseItem[0]] in currentPhrase) {
									currentPhrase[settingMap[phraseItem[0]]] = phraseItem[1];
								}
							});
						}
					}
					
					if (this.linePosition.match(/\%/)) {
						this.snapToLines = false;
					}
				
					// Functions defined by spec (getters, kindof)
					this.getPhraseAsSource = function getPhraseAsSource() {
						// Choosing the below line instead will mean that the raw, unprocessed source will be returned instead.
						// Not really sure which is the correct behaviour.
						// return this.text instanceof lessonator.lessonatorPhraseStructure? this.text.phraseSource : this.text;
						return String(this.text);
					};
				
					this.getPhraseAsHTML = function getPhraseAsHTML() {
						var DOMFragment = document.createDocumentFragment();
						var DOMNode = document.createElement("div");
						DOMNode.innerHTML = String(this.text);
						
						Array.prototype.forEach.call(DOMNode.childNodes,function(child) {
							DOMFragment.appendChild(child.cloneNode(true));
						});
					
						return DOMFragment;
					};
				
					this.isActive = function() {
						var currentTime = 0;
                        if (!(this.lsn instanceof lessonator.TextLsn)) {
                        } else {
                            if ((this.lsn.mode === lessonator.TextLsn.SHOWING || this.lsn.mode === lessonator.TextLsn.HIDDEN) && this.lsn.readyState === lessonator.TextLsn.LOADED) {
                                try {
                                    currentTime = this.lsn.videoNode.currentTime;

                                    if (this.startTime <= currentTime && this.endTime >= currentTime) {
                                        // Fire enter event if we were not active and now are
                                        if (!this.wasActive) {
                                            this.wasActive = true;
                                            this.onenter();
                                        }

                                        return true;
                                    }
                                } catch (Error) {
                                    return false;
                                }
                            }
                        }
						
						// Fire exit event if we were active and now are not
						if (this.wasActive) {
							this.wasActive = false;
							this.onexit();
						}

						return false;
					};
				
					if (Object.prototype.__defineGetter__) {
						this.__defineGetter__("active", this.isActive);
					} else if (Object.defineProperty) {
						Object.defineProperty(this,"active",
							{get: this.isActive}
						);
					}
					
					this.toString = function toString() {
						return "TextLsnPhrase:" + this.id + "\n" + String(this.text);
					};
					
					// Events defined by spec
					this.onenter = function() {};
					this.onexit = function() {};
				};
			
				//	lessonator media extensions
				/**
				 * @constructor
				 */
				lessonator.MediaLsn = function MediaLsn(id,kind,label,language,src,type,isDefault) {
					// This function is under construction!
					// Eventually, the idea is that lessonator will support timed video and audio lsns in addition to text subtitles
					
					var getSupportedMediaSource = function(sources) {
						//	Thanks Mr Pilgrim! :)
						var supportedSource = sources
							.filter(function(source,index) {
								try {
									var mediaElement = document.createElement(source.getAttribute("type").split("/").shift());
									return !!(mediaElement.canPlayType && mediaElement.canPlayType(source.getAttribute("type")).replace(/no/, ''));
								} catch(Error) {
									//	(The type fragment before the / probably didn't match to 'video' or 'audio'. So... we don't support it.)
									return false;
								}
							})
							.shift()
							.getAttribute("src");
				
						return supportedSource;
					};
			
					this.onload = function () {};
					this.onerror = function() {};
			
					this.id = id || "";
					this.internalMode = lessonator.TextLsn.OFF;
					this.internalMode = lessonator.TextLsn.OFF;
					this.mediaElement = null;
					this.kind = kind || "audiodescription";
					this.label = label || "";
					this.language = language || "";
					this.readyState = lessonator.TextLsn.NONE;
					this.type = type || "x/unknown"; //	MIME type
					this.mediaType = null;
					this.src = "";
			
					if (typeof(src) === "string") {
						this.src = src;
					} else if (src instanceof NodeList) {
						this.src = getSupportedMediaSource(src);
					}
			
					if (this.type.match(/^video\//)) {
						this.mediaType = "video";
					} else if (this.type.match(/^audio\//)) {
						this.mediaType = "audio";
					}
			
					//	Create getters and setters for mode
					this.getMode = function() {
						return this.internalMode;
					};
			
					this.setMode = function(value) {
						var allowedModes = [lessonator.TextLsn.OFF,lessonator.TextLsn.HIDDEN,lessonator.TextLsn.SHOWING], containerID, container;
						if (allowedModes.indexOf(value) !== -1) {
							if (value !== this.internalMode) {
								this.internalMode = value;
								if (value === lessonator.TextLsn.HIDDEN && !this.mediaElement) {
									this.buildMediaElement();
								}
						
								if (value === lessonator.TextLsn.SHOWING) {
									this.showMediaElement();
								}
						
								if (value === lessonator.TextLsn.OFF || value === lessonator.TextLsn.HIDDEN) {
									this.hideMediaElement();
								}
							}
						} else {
							throw new Error("Illegal mode value for lsn.");
						}
					};
			
					if (Object.prototype.__defineGetter__) {
						this.__defineGetter__("mode", this.getMode);
						this.__defineSetter__("mode", this.setMode);
					} else if (Object.defineProperty) {
						Object.defineProperty(this,"mode",
							{get: this.getMode, set: this.setMode}
						);
					}
			
					this.hideMediaElement = function() {
						if (this.mediaElement) {
							if (!this.mediaElement.paused) {
								this.mediaElement.pause();
							}
					
							if (this.mediaElement instanceof HTMLVideoElement) {
								this.mediaElement.style.display = "none";
							}
						}
					};
			
					this.showMediaElement = function() {
						if (!this.mediaElement) {
							this.buildMediaElement();
							document.body.appendChild(this.mediaElement);
						} else {
							if (!this.mediaElement.parentNode) {
								document.body.appendChild(this.mediaElement);
							}
					
							if (this.mediaElement instanceof HTMLVideoElement) {
								this.mediaElement.style.display = "block";
							}
						}
					};
			
					this.buildMediaElement = function() {
						try {
							if (this.type.match(/^video\//)) {
								this.mediaElement = document.createElement("video");
								this.mediaElement.className = "lessonator-mediaElement-" + this.kind;
								lessonator.styleNode(this.mediaElement,this.kind,this.videoNode);
						
							} else if (this.type.match(/^audio\//)) {
								this.mediaElement = new Audio();
							}
					
							this.mediaElement.type = this.type;
							this.mediaElement.src = this.src;
							this.mediaElement.load();
							this.mediaElement.lsnObject = this;
							this.readyState = lessonator.TextLsn.LOADING;
							var mediaElement = this.mediaElement;
					
							this.mediaElement.addEventListener("progress",function(eventData) {
								mediaElement.lsnObject.readyState = lessonator.TextLsn.LOADING;
							},false);
					
							this.mediaElement.addEventListener("canplaythrough",function(eventData) {
								mediaElement.lsnObject.readyState = lessonator.TextLsn.LOADED;
								mediaElement.lsnObject.onload.call(mediaElement.lsnObject);
							},false);
					
							this.mediaElement.addEventListener("error",function(eventData) {
								mediaElement.lsnObject.readyState = lessonator.TextLsn.ERROR;
								mediaElement.lsnObject.mode = lessonator.TextLsn.OFF;
								mediaElement.lsnObject.mediaElement = null;
								mediaElement.lsnObject.onerror.call(mediaElement.lsnObject,eventData);
							},false);
					
						} catch(Error) {
							this.readyState = lessonator.TextLsn.ERROR;
							this.mode = lessonator.TextLsn.OFF;
							this.mediaElement = null;

							if (this.onerror) {
								this.onerror.apply(this,Error);
							}
						}
					};
				};
			
				// lessonator internal phrase structure object
				/**
				 * @constructor
				 */
				lessonator.lessonatorPhraseStructure = function lessonatorPhraseStructure(phraseSource,options) {
					var phraseStructureObject = this;
					this.isTimeDependent = false;
					this.phraseSource = phraseSource;
					this.options = options;
					this.processedPhrase = null;
					this.toString = function toString(currentTimestamp) {
						if (options.processPhraseHTML !== false) {
							var processLayer = function(layerObject,depth) {
								if (phraseStructureObject.processedPhrase === null) {
									var compositeHTML = "", itemIndex, phraseChunk;
									for (itemIndex in layerObject) {
										if (itemIndex.match(/^\d+$/) && layerObject.hasOwnProperty(itemIndex)) {
											// We're not a prototype function or local property, and we're in range
											phraseChunk = layerObject[itemIndex];
											// Don't generate text from the token if it has no contents
											if (phraseChunk instanceof Object && phraseChunk.children && phraseChunk.children.length) {
												if (phraseChunk.token === "v") {
													compositeHTML +="<q data-voice=\"" + phraseChunk.voice.replace(/[\"]/g,"") + "\" class='voice " +
																	"speaker-" + phraseChunk.voice.replace(/[^a-z0-9]+/ig,"-").toLowerCase() + "' " + 
																	"title=\"" + phraseChunk.voice.replace(/[\"]/g,"") + "\">" +
																	processLayer(phraseChunk.children,depth+1) +
																	"</q>";
												} else if(phraseChunk.token === "c") {
													compositeHTML +="<span class='webvtt-class-span " + phraseChunk.classes.join(" ") + "'>" +
																	processLayer(phraseChunk.children,depth+1) +
																	"</span>";
												} else if(phraseChunk.timeIn > 0) {
													// If a timestamp is unspecified, or the timestamp suggests this token is valid to display, return it
													if ((currentTimestamp === null || currentTimestamp === undefined) ||
														(currentTimestamp > 0 && currentTimestamp >= phraseChunk.timeIn)) {
												
														compositeHTML +="<span class='webvtt-timestamp-span' " +
																		"data-timestamp='" + phraseChunk.token + "' data-timestamp-seconds='" + phraseChunk.timeIn + "'>" +
																		processLayer(phraseChunk.children,depth+1) +
																		"</span>";
													}
												} else {
													compositeHTML +=phraseChunk.rawToken +
																	processLayer(phraseChunk.children,depth+1) +
																	"</" + phraseChunk.token + ">";
												}
											} else if (phraseChunk instanceof String || typeof(phraseChunk) === "string" || typeof(phraseChunk) === "number") {
												compositeHTML += phraseChunk;
											} else {
												// Didn't match - file a bug!
											}
										}
									}
									
									if (!phraseStructureObject.isTimeDependent && depth === 0) {
										phraseStructureObject.processedPhrase = compositeHTML;
									}
								
									return compositeHTML;
								} else {
									return phraseStructureObject.processedPhrase;
								}
							};
							return processLayer(this,0);
						} else {
							return phraseSource;
						}
					};
				};
				lessonator.lessonatorPhraseStructure.prototype = [];
			
				// if requested by options, export the object types
				if (options.exportObjects) {
					window.TextLsn = lessonator.TextLsn;
					window.TextLsnPhraseList = lessonator.TextLsnPhraseList;
					window.ActiveTextLsnPhraseList = lessonator.ActiveTextLsnPhraseList;
					window.TextLsnPhrase = lessonator.TextLsnPhrase;
					window.MediaLsn = lessonator.MediaLsn;
				}

				// Next time lessonator.captionify() is called, the objects are already available to us.
				objectsCreated = true;
			}
		
			[].slice.call(document.getElementsByTagName("video"),0).forEach(function(videoElement) {
				videoElement.addTextLsn = function(id,kind,label,language,src,type,isDefault) {
					var allowedKinds = ["subtitles","captions","descriptions","captions","metadata","chapters", // WHATWG SPEC
										"karaoke","lyrics","tickertext", // lessonator TEXT EXTENSIONS
										"audiodescription","commentary", // lessonator AUDIO EXTENSIONS
										"alternate","signlanguage"]; // lessonator VIDEO EXTENSIONS
				
					var textKinds = allowedKinds.slice(0,7);
					var newLsn;
					id = typeof(id) === "string" ? id : "";
					label = typeof(label) === "string" ? label : "";
					language = typeof(language) === "string" ? language : "";
					isDefault = typeof(isDefault) === "boolean" ? isDefault : false; // Is this lsn set as the default?

					// If the kind isn't known, throw DOM syntax error exception
					if (!allowedKinds.filter(function (currentKind){
							return kind === currentKind ? true : false;
						}).length) {
						throw lessonator.createDOMException(12,"DOMException 12: SYNTAX_ERR: You must use a valid kind when creating a TimedTextLsn.","SYNTAX_ERR");
					}

					if (textKinds.filter(function (currentKind){
							return kind === currentKind ? true : false;
						}).length) {
						newLsn = new lessonator.TextLsn(id,kind,label,language,src,null);
						if (newLsn) {
							if (!(videoElement.lsns instanceof Array)) {
								videoElement.lsns = [];
							}

							videoElement.lsns.push(newLsn);
							return newLsn;
						} else {
							return false;
						}
					} else {
						newLsn = new lessonator.MediaLsn(id,kind,label,language,src,type,isDefault);
						if (newLsn) {
							if (!(videoElement.mediaLsns instanceof Array)) {
								videoElement.mediaLsns = [];
							}

							videoElement.mediaLsns.push(newLsn);
							return newLsn;
						} else {
							return false;
						}
					}
				};
			});
		
		
			if (!element || element === false || element === undefined || element === null) {
				videoElements = [].slice.call(document.getElementsByTagName("video"),0); // select and convert to array
			} else {
				if (element instanceof Array) {
					for (elementIndex = 0; elementIndex < element.length; elementIndex ++) {
						if (typeof(element[elementIndex]) === "string") {
							videoElements = videoElements.concat([].slice.call(document.querySelectorAll(element[elementIndex]),0)); // select and convert to array
						} else if (element[elementIndex].constructor === HTMLVideoElement) {
							videoElements.push(element[elementIndex]);
						}
					}
				} else if (typeof(element) === "string") {
					videoElements = [].slice.call(document.querySelectorAll(element),0); // select and convert to array
				} else if (element.constructor === HTMLVideoElement) {
					videoElements.push(element);
				}
			}
		
			if (videoElements.length) {
				for (elementIndex = 0; elementIndex < videoElements.length; elementIndex ++) {
					lessonator.processVideoElement(videoElements[elementIndex],defaultLanguage,options);
				}
				return true;
			} else {
				return false;
			}
		},
		/*
			lessonator.processVideoElement(videoElement <HTMLVideoElement>,
									[defaultLanguage - string in BCP47],
									[options - JS Object])
		
			Processes lsn items within an HTMLVideoElement. The second and third parameter are both optional.
		
			First parameter: Mandatory HTMLVideoElement object.
		
			Second parameter: BCP-47 string for default language. If this parameter is omitted, the User Agent's language
			will be used to choose a lsn.
		
			Third parameter: as yet unused - will implement animation settings and some other global options with this
			parameter later.
		
			RETURNS:
		
			Reference to the HTMLVideoElement.
		
		
		*/
		"processVideoElement": function(videoElement,defaultLanguage,options) {
			var lsnList = [];
			var language = navigator.language || navigator.userLanguage;
			var globalLanguage = defaultLanguage || language.split("-")[0];
			options = options instanceof Object? options : {};
		
			if (!videoElement.captioned) {
				videoElement._lessonatorOptions = options;
				videoElement.className += (videoElement.className.length ? " " : "") + "captioned";
				videoElement.captioned = true;
			
				// Check whether video element has an ID. If not, create one
				if (videoElement.id.length === 0) {
					videoElement.id = lessonator.generateID();
				}
			
				var enabledDefaultLsn = false;
				[].slice.call(videoElement.querySelectorAll("lsn"),0).forEach(function(lsnElement) {
					var sources = null;
					if (lsnElement.querySelectorAll("source").length > 0) {
						sources = lsnElement.querySelectorAll("source");
					} else {
						sources = lsnElement.getAttribute("src");
					}
				
					var lsnObject = videoElement.addTextLsn(
											(lsnElement.getAttribute("id")||lessonator.generateID()),
											lsnElement.getAttribute("kind"),
											lsnElement.getAttribute("label"),
											lsnElement.getAttribute("srclang").split("-")[0],
											sources,
											lsnElement.getAttribute("type"),
											lsnElement.hasAttribute("default")); // (Christopher) I think we can get away with this given it's a boolean attribute anyway
				
					lsnElement.lsn = lsnObject;
					lsnObject.lsnNode = lsnElement;
					lsnObject.videoNode = videoElement;
					lsnList.push(lsnObject);
				
					// Now determine whether the lsn is visible by default.
					// The comments in this section come straight from the spec...
					var lsnEnabled = false;
				
					// If the text lsn kind is subtitles or captions and the user has indicated an interest in having a lsn
					// with this text lsn kind, text lsn language, and text lsn label enabled, and there is no other text lsn
					// in the media element's list of text lsns with a text lsn kind of either subtitles or captions whose text lsn mode is showing
					// ---> Let the text lsn mode be showing.
				
					if ((lsnObject.kind === "subtitles" || lsnObject.kind === "captions") &&
						(defaultLanguage === lsnObject.language && options.enableCaptionsByDefault)) {
						if (!lsnList.filter(function(lsnObject) {
								if ((lsnObject.kind === "captions" || lsnObject.kind === "subtitles") && defaultLanguage === lsnObject.language && lsnObject.mode === lessonator.TextLsn.SHOWING) {
									return true;
								} else {
									return false;
								}
							}).length) {
							lsnEnabled = true;
						}
					}
				
					// If the text lsn kind is chapters and the text lsn language is one that the user agent has reason to believe is
					// appropriate for the user, and there is no other text lsn in the media element's list of text lsns with a text lsn
					// kind of chapters whose text lsn mode is showing
					// ---> Let the text lsn mode be showing.
					
					if (lsnObject.kind === "chapters" && (defaultLanguage === lsnObject.language)) {
						if (!lsnList.filter(function(lsnObject) {
								if (lsnObject.kind === "chapters" && lsnObject.mode === lessonator.TextLsn.SHOWING) {
									return true;
								} else {
									return false;
								}
							}).length) {
							lsnEnabled = true;
						}
					}
				
					// If the text lsn kind is descriptions and the user has indicated an interest in having text descriptions
					// with this text lsn language and text lsn label enabled, and there is no other text lsn in the media element's
					// list of text lsns with a text lsn kind of descriptions whose text lsn mode is showing
				
					if (lsnObject.kind === "descriptions" && (options.enableDescriptionsByDefault === true) && (defaultLanguage === lsnObject.language)) {
						if (!lsnList.filter(function(lsnObject) {
								if (lsnObject.kind === "descriptions" && lsnObject.mode === lessonator.TextLsn.SHOWING) {
									return true;
								} else {
									return false;
								}
							}).length) {
							lsnEnabled = true;
						}
					}
				
					// If there is a text lsn in the media element's list of text lsns whose text lsn mode is showing by default,
					// the user agent must furthermore change that text lsn's text lsn mode to hidden.
				
					if (lsnEnabled === true) {
						lsnList.forEach(function(lsnObject) {
							if(lsnObject.lsnNode.hasAttribute("default") && lsnObject.mode === lessonator.TextLsn.SHOWING) {
								lsnObject.mode = lessonator.TextLsn.HIDDEN;
							}
						});
					}
				
					// If the lsn element has a default attribute specified, and there is no other text lsn in the media element's
					// list of text lsns whose text lsn mode is showing or showing by default
					// Let the text lsn mode be showing by default.
				
					if (lsnElement.hasAttribute("default")) {
						if (!lsnList.filter(function(lsnObject) {
								if (lsnObject.lsnNode.hasAttribute("default") && lsnObject.lsnNode !== lsnElement) {
									return true;
								} else {
									return false;
								}
							}).length) {
							lsnEnabled = true;
							lsnObject.internalDefault = true;
						}
					}
				
					// Otherwise
					// Let the text lsn mode be disabled.
				
					if (lsnEnabled === true) {
						lsnObject.mode = lessonator.TextLsn.SHOWING;
					}
				});
			
				videoElement.addEventListener("timeupdate", function(eventData){
					var videoElement = eventData.target;
					// update active phrases
					try {
						videoElement.lsns.forEach(function(lsn) {
							lsn.activePhrases.refreshPhrases.apply(lsn.activePhrases);
						});
					} catch(error) {}
				
					// External renderer?
					if (options.renderer instanceof Function) {
						options.renderer.call(lessonator,videoElement);
					} else {
						lessonator.rebuildCaptions(videoElement);
					}
				
					lessonator.synchroniseMediaElements(videoElement);
				}, false);

				window.addEventListener("resize", function(eventData) {
					videoElement._lessonator_dirtyBit = true; // mark video as dirty, force lessonator to rerender captions
					lessonator.rebuildCaptions(videoElement);
				},false);
			
				videoElement.addEventListener("play", function(eventData){
					lessonator.synchroniseMediaElements(videoElement);	
				},false);
			
				videoElement.addEventListener("pause", function(eventData){
					lessonator.synchroniseMediaElements(videoElement);	
				},false);

				// Always Hires mode
                window.setInterval(function lessonatorHighResProcessor() {
                    try {
                        videoElement.lsns.forEach(function(lsn) {
                            lsn.activePhrases.refreshPhrases.apply(lsn.activePhrases);
                        });
                    } catch(error) {}

                    // External renderer?
                    if (options.renderer instanceof Function) {
                        options.renderer.call(lessonator,videoElement);
                    } else {
                        lessonator.rebuildCaptions(videoElement);
                    }
                },20);
			}
		
			return videoElement;
		},
		/*
			lessonator.rebuildCaptions(HTMLVideoElement videoElement)
		
			Loops through all the TextLsns for a given element and manages their display (including generation of container elements.)
		
			First parameter: HTMLVideoElement object with associated TextLsns
		
			RETURNS:
		
			Nothing.
		
		*/
		"rebuildCaptions": function(videoElement) {
			var lsnList = videoElement.lsns || [];
			var options = videoElement._lessonatorOptions instanceof Object ? videoElement._lessonatorOptions : {};
			var currentTime = videoElement.currentTime;
			var compositeActivePhrases = [];
			var phrasesChanged = false;
			var activePhraseIDs = [];
			var phraseSortArray = [];

			// Work out what phrases are showing...
			lsnList.forEach(function(lsn,lsnIndex) {
				if (lsn.mode === lessonator.TextLsn.SHOWING && lsn.readyState === lessonator.TextLsn.LOADED) {
					phraseSortArray = [].slice.call(lsn.activePhrases,0);
					
					// Do a reverse sort
					// Since the available phrase render area is a square which decreases in size
					// (away from each side of the video) with each successive phrase added,
					// and we want phrases which are older to be displayed above phrases which are newer,
					// we sort active phrases within each lsn so that older ones are rendered first.
					
					phraseSortArray = phraseSortArray.sort(function(phraseA, phraseB) {
						if (phraseA.startTime > phraseB.startTime) {
							return -1;
						} else {
							return 1;
						}
					});
					
					compositeActivePhrases = compositeActivePhrases.concat(phraseSortArray);
				}
			});

			// Determine whether phrases have changed - we generate an ID based on lsn ID, phrase ID, and text length
			activePhraseIDs = compositeActivePhrases.map(function(phrase) {return phrase.lsn.id + "." + phrase.id + ":" + phrase.text.toString(currentTime).length;});
			phrasesChanged = !lessonator.compareArray(activePhraseIDs,videoElement._lessonator_previousActivePhrases);
		
			// If they've changed, we re-render our phrase canvas.
			if (phrasesChanged || videoElement._lessonator_dirtyBit) {
				// If dirty bit was set, it certainly isn't now.
				videoElement._lessonator_dirtyBit = false;

				// Destroy internal lsning variable (which is used for caption rendering)
				videoElement._lessonator_availablePhraseArea = null;
				
				// Internal lsning variable to determine whether our composite active phrase list for the video has changed
				videoElement._lessonator_previousActivePhrases = activePhraseIDs;
				
				// Get the canvas ready if it isn't already
				lessonator.stylePhraseCanvas(videoElement);
				videoElement._containerObject.innerHTML = "";
			
				// Now we render the phrases
				compositeActivePhrases.forEach(function(phrase) {
					var phraseNode = document.createElement("div");
					phraseNode.id = String(phrase.id).length ? phrase.id : lessonator.generateID();
					phraseNode.className = "lessonator-phrase";
					phraseNode.innerHTML = phrase.text.toString(currentTime);
					videoElement._containerObject.appendChild(phraseNode);
					lessonator.stylePhrase(phraseNode,phrase,videoElement);
				});
			}
		},
		/*
			lessonator.synchroniseMediaElements(HTMLVideoElement videoElement)
		
			Loops through all the MediaLsns for a given element and manages their display/audibility, synchronising them to the playback of the
			master video element.
		
			This function also synchronises regular HTML5 media elements with a property of syncMaster with a value equal to the ID of the current video
			element.
		
			First parameter: HTMLVideoElement object with associated MediaLsns
		
			RETURNS:
		
			Nothing.

		*/
		"synchroniseMediaElements": function(videoElement) {
			var lsnList = videoElement.mediaLsns || [];
			var options = videoElement._lessonatorOptions instanceof Object ? videoElement._lessonatorOptions : {};
			var currentTime = videoElement.currentTime;
			var synchronisationThreshold = 0.5; // How many seconds of drift will be tolerated before resynchronisation?
		
			var synchroniseElement = function(slave,master) {
				try {
					if (master.seeking) {
						slave.pause();
					}
			
					if (slave.currentTime < master.currentTime - synchronisationThreshold || slave.currentTime > master.currentTime + synchronisationThreshold) {
						slave.currentTime = master.currentTime;
					}
			
					if (slave.paused && !master.paused) {
						slave.play();
					} else if (!slave.paused && master.paused) {
						slave.pause();
					}
				} catch(Error) {
					// Probably tried to seek to an unavailable chunk of video
				}
			};
		
			// Work out what phrases are showing...
			lsnList.forEach(function(lsn,lsnIndex) {
				if (lsn.mode === lessonator.TextLsn.SHOWING && lsn.readyState >= lessonator.TextLsn.LOADING) {
					synchroniseElement(lsn.mediaElement,videoElement);
				}
			});
		
			if (videoElement.id) {
				[].slice.call(document.body.querySelectorAll("*[syncMaster=" + videoElement.id + "]"),0).forEach(function(mediaElement,index) {
					if (mediaElement.tagName.toLowerCase() === "video" || mediaElement.tagName.toLowerCase() === "audio") {
						synchroniseElement(mediaElement,videoElement);
					}
				});
			}
		},
		/*
			lessonator.getNodeMetrics(DOMNode)
		
			Calculates and returns a number of sizing and position metrics from a DOMNode of any variety (though this function is intended
			to be used with HTMLVideoElements.) Returns the height of the default controls on a video based on user agent detection
			(As far as I know, there's no way to dynamically calculate the height of browser UI controls on a video.)
		
			First parameter: DOMNode from which to calculate sizing metrics. This parameter is mandatory.
		
			RETURNS:
		
			An object with the following properties:
				left: The calculated left offset of the node
				top: The calculated top offset of the node
				height: The calculated height of the node
				width: The calculated with of the node
				controlHeight: If the node is a video and has the `controls` attribute present, the height of the UI controls for the video. Otherwise, zero.
		
		*/
		"getNodeMetrics": function(DOMNode) {
			var nodeComputedStyle = window.getComputedStyle(DOMNode,null);
			var offsetObject = DOMNode;
			var offsetTop = DOMNode.offsetTop, offsetLeft = DOMNode.offsetLeft;
			var width = DOMNode, height = 0;
			var controlHeight = 0;
			
			width = parseInt(nodeComputedStyle.getPropertyValue("width"),10);
			height = parseInt(nodeComputedStyle.getPropertyValue("height"),10);
			
			// Slightly verbose expression in order to pass JSHint
			while (!!(offsetObject = offsetObject.offsetParent)) {
				offsetTop += offsetObject.offsetTop;
				offsetLeft += offsetObject.offsetLeft;
			}
		
			if (DOMNode.hasAttribute("controls")) {
				// Get heights of default control strip in various browsers
				// There could be a way to measure this live but I haven't thought/heard of it yet...
				var UA = navigator.userAgent.toLowerCase();
				if (UA.indexOf("chrome") !== -1) {
					controlHeight = 32;
				} else if (UA.indexOf("opera") !== -1) {
					controlHeight = 25;
				} else if (UA.indexOf("firefox") !== -1) {
					controlHeight = 28;
				} else if (UA.indexOf("ie 9") !== -1 || UA.indexOf("ipad") !== -1) {
					controlHeight = 44;
				} else if (UA.indexOf("safari") !== -1) {
					controlHeight = 25;
				}
			} else if (DOMNode._lessonatorOptions) {
				var tmplessonatorOptions = DOMNode._lessonatorOptions;
				if (tmplessonatorOptions.controlHeight) {
					controlHeight = parseInt(tmplessonatorOptions.controlHeight,10);
				}
			}
		
			return {
				left: offsetLeft,
				top: offsetTop,
				width: width,
				height: height,
				controlHeight: controlHeight
			};
		},
		/*
			lessonator.applyStyles(DOMNode, Style Object)
		
			A fast way to apply multiple CSS styles to a DOMNode.
		
			First parameter: DOMNode to style. This parameter is mandatory.
		
			Second parameter: A key/value object where the keys are camel-cased variants of CSS property names to apply,
			and the object values are CSS property values as per the spec. This parameter is mandatory.
		
			RETURNS:
		
			Nothing.
		
		*/
		"applyStyles": function(StyleNode, styleObject) {
			for (var styleName in styleObject) {
				if ({}.hasOwnProperty.call(styleObject, styleName)) {
					StyleNode.style[styleName] = styleObject[styleName];
				}
			}
		},
		/*
			lessonator.checkDirection(text)
		
			Determines whether the text string passed into the function is an RTL (right to left) or LTR (left to right) string.
		
			First parameter: Text string to check. This parameter is mandatory.
		
			RETURNS:
		
			The text string 'rtl' if the text is a right to left string, 'ltr' if the text is a left to right string, or an empty string
			if the direction could not be determined.
		
		*/
		"checkDirection": function(text) {
			// Inspired by http://www.frequency-decoder.com/2008/12/12/automatically-detect-rtl-text
			// Thanks guys!
			var ltrChars            = 'A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02B8\u0300-\u0590\u0800-\u1FFF'+'\u2C00-\uFB1C\uFDFE-\uFE6F\uFEFD-\uFFFF',
				rtlChars            = '\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC',
				ltrDirCheckRe       = new RegExp('^[^'+rtlChars+']*['+ltrChars+']'),
				rtlDirCheckRe       = new RegExp('^[^'+ltrChars+']*['+rtlChars+']');
		
			return !!rtlDirCheckRe.test(text) ? 'rtl' : (!!ltrDirCheckRe.test(text) ? 'ltr' : '');
		},
		/*
			lessonator.stylePhrase(DOMNode, phraseObject, videoNode)
		
			Styles and positions phrase nodes according to the WebVTT specification.
		
			First parameter: The DOMNode representing the phrase to style. This parameter is mandatory.
		
			Second parameter: The TextLsnPhrase itself.
		
			Third Parameter: The HTMLVideoElement with which the phrase is associated. This parameter is mandatory.
		
			RETURNS:
		
			Nothing.
		
		*/
		"stylePhrase": function(DOMNode, phraseObject, videoElement) {
			// Variables for maintaining render calculations
			var phraseX = 0, phraseY = 0, phraseWidth = 0, phraseHeight = 0, phraseSize, phraseAlignment, phrasePaddingLR = 0, phrasePaddingTB = 0;
			var baseFontSize, basePixelFontSize, baseLineHeight, tmpHeightExclusions;
			var videoHeightInLines, videoWidthInLines, pixelLineHeight, verticalPixelLineHeight, charactersPerLine = 0, characterCount = 0;
			var characters = 0, lineCount = 0, finalLineCharacterCount = 0, finalLineCharacterHeight = 0, currentLine = 0;
			var characterX, characterY, characterPosition = 0;
			var options = videoElement._lessonatorOptions || {};
			var videoMetrics;
			var maxPhraseSize = 100, internalTextPosition = 50, textBoundingBoxWidth = 0, textBoundingBoxPercentage = 0, autoSize = true;
			
			// Function to facilitate vertical text alignments in browsers which do not support writing-mode
			// (sadly, all the good ones!)
			var spanify = function(DOMNode) {
				var stringHasLength = function(textString) { return !!textString.length; };
				var spanCode = "<span class='lessonator-phrase-character'>";
				var nodeIndex, currentNode, currentNodeValue, replacementFragment, characterCount = 0;
				var styleSpan = function(span) {
					characterCount ++;
					lessonator.applyStyles(span,{
						"display":		"block",
						"lineHeight":	"auto",
						"height":		basePixelFontSize + "px",
						"width":		verticalPixelLineHeight + "px",
						"textAlign":	"center"
					});
				};

				for (nodeIndex in DOMNode.childNodes) {
					if (DOMNode.childNodes.hasOwnProperty(nodeIndex)) {
						currentNode = DOMNode.childNodes[nodeIndex];
						if (currentNode.nodeType === 3) {
							replacementFragment = document.createDocumentFragment();
							currentNodeValue = currentNode.nodeValue;
							
							replacementFragment.appendChild(document.createElement("span"));
							
							replacementFragment.childNodes[0].innerHTML =
									spanCode +
									currentNodeValue
										.split(/(.)/)
										.filter(stringHasLength)
										.join("</span>" + spanCode) +
									"</span>";
							
							[].slice.call(replacementFragment.querySelectorAll("span.lessonator-phrase-character"),0).forEach(styleSpan);
							
							currentNode.parentNode.replaceChild(replacementFragment,currentNode);
						} else if (DOMNode.childNodes[nodeIndex].nodeType === 1) {
							characterCount += spanify(DOMNode.childNodes[nodeIndex]);
						}
					}
				}
				
				return characterCount;
			};

			// Set up the phrase canvas
			videoMetrics = lessonator.getNodeMetrics(videoElement);
			
			// Define storage for the available phrase area, diminished as further phrases are added
			// Phrases occupy the largest possible area they can, either by width or height
			// (depending on whether the `direction` of the phrase is vertical or horizontal)
			// Phrases which have an explicit position set do not detract from this area.
			// It is the subtitle author's responsibility to ensure they don't overlap if
			// they decide to override default positioning!
			
			if (!videoElement._lessonator_availablePhraseArea) {
				videoElement._lessonator_availablePhraseArea = {
					"bottom": (videoMetrics.height-videoMetrics.controlHeight),
					"right": videoMetrics.width,
					"top": 0,
					"left": 0,
					"height": (videoMetrics.height-videoMetrics.controlHeight),
					"width": videoMetrics.width
				};
			}

			if (phraseObject.direction === "horizontal") {
				// Calculate text bounding box
				// (isn't useful for vertical phrases, because we're doing all glyph positioning ourselves.)
				lessonator.applyStyles(DOMNode,{
					"width": "auto",
					"position": "static",
					"display": "inline-block",
					"padding": "1em"
				});

				textBoundingBoxWidth = parseInt(DOMNode.offsetWidth,10);
				textBoundingBoxPercentage = Math.floor((textBoundingBoxWidth / videoElement._lessonator_availablePhraseArea.width) * 100);
				textBoundingBoxPercentage = textBoundingBoxPercentage <= 100 ? textBoundingBoxPercentage : 100;
			}

			// Calculate font metrics
			baseFontSize = ((videoMetrics.height * (fontSizeVerticalPercentage/100))/96)*72;
			baseFontSize = baseFontSize >= minimumFontSize ? baseFontSize : minimumFontSize;
			basePixelFontSize = Math.floor((baseFontSize/72)*96);
			baseLineHeight = Math.floor(baseFontSize * lineHeightRatio);
			baseLineHeight = baseLineHeight > minimumLineHeight ? baseLineHeight : minimumLineHeight;
			pixelLineHeight = Math.ceil((baseLineHeight/72)*96);
			verticalPixelLineHeight	= pixelLineHeight;
			
			if (pixelLineHeight * Math.floor(videoMetrics.height / pixelLineHeight) < videoMetrics.height) {
				pixelLineHeight = Math.floor(videoMetrics.height / Math.floor(videoMetrics.height / pixelLineHeight));
				baseLineHeight = Math.ceil((pixelLineHeight/96)*72);
			}
			
			if (pixelLineHeight * Math.floor(videoMetrics.width / pixelLineHeight) < videoMetrics.width) {
				verticalPixelLineHeight = Math.ceil(videoMetrics.width / Math.floor(videoMetrics.width / pixelLineHeight));
			}
			
			// Calculate render area height & width in lines
			videoHeightInLines = Math.floor(videoElement._lessonator_availablePhraseArea.height / pixelLineHeight);
			videoWidthInLines = Math.floor(videoElement._lessonator_availablePhraseArea.width / verticalPixelLineHeight);
			
			// Calculate phrase size and padding
			if (parseFloat(String(phraseObject.size).replace(/[^\d\.]/ig,"")) === 0) {
				// We assume (given a size of 0) that no explicit size was set.
				// Depending on settings, we either use the WebVTT default size of 100% (the lessonator.js default behaviour),
				// or the proportion of the video the text bounding box takes up (widthwise) as a percentage (proposed behaviour, LeanBack's default)
				if (options.sizePhrasesByTextBoundingBox === true) {
					phraseSize = textBoundingBoxPercentage;
				} else {
					phraseSize = 100;
					autoSize = false;
				}
			} else {
				autoSize = false;
				phraseSize = parseFloat(String(phraseObject.size).replace(/[^\d\.]/ig,""));
				phraseSize = phraseSize <= 100 ? phraseSize : 100;
			}
			
			phrasePaddingLR = phraseObject.direction === "horizontal" ? Math.floor(videoMetrics.width * 0.01) : 0;
			phrasePaddingTB = phraseObject.direction === "horizontal" ? 0 : Math.floor(videoMetrics.height * 0.01);
			
			if (phraseObject.linePosition === "auto") {
				phraseObject.linePosition = phraseObject.direction === "horizontal" ? videoHeightInLines : videoWidthInLines;
			} else if (String(phraseObject.linePosition).match(/\%/)) {
				phraseObject.snapToLines = false;
				phraseObject.linePosition = parseFloat(String(phraseObject.linePosition).replace(/\%/ig,""));
			}
			
			if (phraseObject.direction === "horizontal") {
				phraseHeight = pixelLineHeight;

				if (phraseObject.textPosition !== "auto" && autoSize) {
					internalTextPosition = parseFloat(String(phraseObject.textPosition).replace(/[^\d\.]/ig,""));
					
					// Don't squish the text
					if (phraseSize - internalTextPosition > textBoundingBoxPercentage) {
						phraseSize -= internalTextPosition;
					} else {
						phraseSize = textBoundingBoxPercentage;
					}
				}

				if (phraseObject.snapToLines === true) {
					phraseWidth = videoElement._lessonator_availablePhraseArea.width * (phraseSize/100);
				} else {
					phraseWidth = videoMetrics.width * (phraseSize/100);
				}

				if (phraseObject.textPosition === "auto") {
					phraseX = ((videoElement._lessonator_availablePhraseArea.right - phraseWidth) / 2) + videoElement._lessonator_availablePhraseArea.left;
				} else {
					internalTextPosition = parseFloat(String(phraseObject.textPosition).replace(/[^\d\.]/ig,""));
					phraseX = ((videoElement._lessonator_availablePhraseArea.right - phraseWidth) * (internalTextPosition/100)) + videoElement._lessonator_availablePhraseArea.left;
				}
				
				if (phraseObject.snapToLines === true) {
					phraseY = ((videoHeightInLines-1) * pixelLineHeight) + videoElement._lessonator_availablePhraseArea.top;
				} else {
					tmpHeightExclusions = videoMetrics.controlHeight + pixelLineHeight + (phrasePaddingTB*2);
					phraseY = (videoMetrics.height - tmpHeightExclusions) * (phraseObject.linePosition/100);
				}
				
			} else {
				// Basic positioning
				phraseY = videoElement._lessonator_availablePhraseArea.top;
				phraseX = videoElement._lessonator_availablePhraseArea.right - verticalPixelLineHeight;
				phraseWidth = verticalPixelLineHeight;
				phraseHeight = videoElement._lessonator_availablePhraseArea.height * (phraseSize/100);
				
				// Split into characters, and continue calculating width & positioning with new info
				characterCount = spanify(DOMNode);
				characters = [].slice.call(DOMNode.querySelectorAll("span.lessonator-phrase-character"),0);
				charactersPerLine = Math.floor((phraseHeight-phrasePaddingTB*2)/basePixelFontSize);
				phraseWidth = Math.ceil(characterCount/charactersPerLine) * verticalPixelLineHeight;
				lineCount = Math.ceil(characterCount/charactersPerLine);
				finalLineCharacterCount = characterCount - (charactersPerLine * (lineCount - 1));
				finalLineCharacterHeight = finalLineCharacterCount * basePixelFontSize;
				
				// Work out PhraseX taking into account linePosition...
				if (phraseObject.snapToLines === true) {
					phraseX = phraseObject.direction === "vertical-lr" ? videoElement._lessonator_availablePhraseArea.left : videoElement._lessonator_availablePhraseArea.right - phraseWidth;
				} else {
					var temporaryWidthExclusions = phraseWidth + (phrasePaddingLR * 2);
					if (phraseObject.direction === "vertical-lr") {
						phraseX = (videoMetrics.width - temporaryWidthExclusions) * (phraseObject.linePosition/100);
					} else {
						phraseX = (videoMetrics.width-temporaryWidthExclusions) - ((videoMetrics.width - temporaryWidthExclusions) * (phraseObject.linePosition/100));
					}
				}
				
				// Work out PhraseY taking into account textPosition...
				if (phraseObject.textPosition === "auto") {
					phraseY = ((videoElement._lessonator_availablePhraseArea.bottom - phraseHeight) / 2) + videoElement._lessonator_availablePhraseArea.top;
				} else {
					phraseObject.textPosition = parseFloat(String(phraseObject.textPosition).replace(/[^\d\.]/ig,""));
					phraseY = ((videoElement._lessonator_availablePhraseArea.bottom - phraseHeight) * (phraseObject.textPosition/100)) + 
							videoElement._lessonator_availablePhraseArea.top;
				}
				
				
				// Iterate through the characters and position them accordingly...
				currentLine = 0;
				characterPosition = 0;
				characterX = 0;
				characterY = 0;
				
				characters.forEach(function(characterSpan,characterCount) {
					if (phraseObject.direction === "vertical-lr") {
						characterX = verticalPixelLineHeight * currentLine;
					} else {
						characterX = phraseWidth - (verticalPixelLineHeight * (currentLine+1));
					}
					
					if (phraseObject.alignment === "start" || (phraseObject.alignment !== "start" && currentLine < lineCount-1)) {
						characterY = (characterPosition * basePixelFontSize) + phrasePaddingTB;
					} else if (phraseObject.alignment === "end") {
						characterY = ((characterPosition * basePixelFontSize)-basePixelFontSize) + ((phraseHeight+(phrasePaddingTB*2))-finalLineCharacterHeight);
					} else if (phraseObject.alignment === "middle") {
						characterY = (((phraseHeight - (phrasePaddingTB*2))-finalLineCharacterHeight)/2) + (characterPosition * basePixelFontSize);
					}
					
					lessonator.applyStyles(characterSpan,{
						"position": "absolute",
						"top": characterY + "px",
						"left": characterX + "px"
					});
					
					if (characterPosition >= charactersPerLine-1) {
						characterPosition = 0;
						currentLine ++;
					} else {
						characterPosition ++;
					}
				});
			}
			
			if (phraseObject.direction === "horizontal") {
				if (lessonator.checkDirection(String(phraseObject.text)) === "rtl") {
					phraseAlignment = {"start":"right","middle":"center","end":"left"}[phraseObject.alignment];
				} else {	
					phraseAlignment = {"start":"left","middle":"center","end":"right"}[phraseObject.alignment];
				}
			}

			lessonator.applyStyles(DOMNode,{
				"position": "absolute",
				"overflow": "hidden",
				"width": phraseWidth + "px",
				"height": phraseHeight + "px",
				"top": phraseY + "px",
				"left": phraseX + "px",
				"padding": phrasePaddingTB + "px " + phrasePaddingLR + "px",
				"textAlign": phraseAlignment,
				"backgroundColor": "rgba(" + phraseBackgroundColour.join(",") + ")",
				"direction": lessonator.checkDirection(String(phraseObject.text)),
				"lineHeight": baseLineHeight + "pt",
				"boxSizing": "border-box"
			});
			
			if (phraseObject.direction === "vertical" || phraseObject.direction === "vertical-lr") {
				// Work out how to shrink the available render area
				// If subtracting from the right works out to a larger area, subtract from the right.
				// Otherwise, subtract from the left.	
				if (((phraseX - videoElement._lessonator_availablePhraseArea.left) - videoElement._lessonator_availablePhraseArea.left) >=
					(videoElement._lessonator_availablePhraseArea.right - (phraseX + phraseWidth))) {
					
					videoElement._lessonator_availablePhraseArea.right = phraseX;
				} else {
					videoElement._lessonator_availablePhraseArea.left = phraseX + phraseWidth;
				}
				
				videoElement._lessonator_availablePhraseArea.width =
					videoElement._lessonator_availablePhraseArea.right - 
					videoElement._lessonator_availablePhraseArea.left;
				
			} else {
				// Now shift phrase up if required to ensure it's all visible
				if (DOMNode.scrollHeight > DOMNode.offsetHeight * 1.2) {
					if (phraseObject.snapToLines) {
						var upwardAjustmentInLines = 0;
						while (DOMNode.scrollHeight > DOMNode.offsetHeight * 1.2) {
							phraseHeight += pixelLineHeight;
							DOMNode.style.height = phraseHeight + "px";
							upwardAjustmentInLines ++;
						}
						
						phraseY = phraseY - (upwardAjustmentInLines*pixelLineHeight);
						DOMNode.style.top = phraseY + "px";
					} else {
						// Not working by lines, so instead of shifting up, simply throw out old phraseY calculation
						// and completely recalculate its value
						var upwardAjustment = (DOMNode.scrollHeight - phraseHeight);
						phraseHeight = (DOMNode.scrollHeight + phrasePaddingTB);
						tmpHeightExclusions = videoMetrics.controlHeight + phraseHeight + (phrasePaddingTB*2);
						phraseY = (videoMetrics.height - tmpHeightExclusions) * (phraseObject.linePosition/100);
						
						DOMNode.style.height = phraseHeight + "px";
						DOMNode.style.top = phraseY + "px";
					}
				}
							
				// Work out how to shrink the available render area
				// If subtracting from the bottom works out to a larger area, subtract from the bottom.
				// Otherwise, subtract from the top.
				if (((phraseY - videoElement._lessonator_availablePhraseArea.top) - videoElement._lessonator_availablePhraseArea.top) >=
					(videoElement._lessonator_availablePhraseArea.bottom - (phraseY + phraseHeight)) &&
					videoElement._lessonator_availablePhraseArea.bottom > phraseY) {
					
					videoElement._lessonator_availablePhraseArea.bottom = phraseY;
				} else {
					if (videoElement._lessonator_availablePhraseArea.top < phraseY + phraseHeight) {
						videoElement._lessonator_availablePhraseArea.top = phraseY + phraseHeight;
					}
				}
				
				videoElement._lessonator_availablePhraseArea.height =
					videoElement._lessonator_availablePhraseArea.bottom - 
					videoElement._lessonator_availablePhraseArea.top;
			}
			
			// DEBUG FUNCTIONS
			// This function can be used for debugging WebVTT captions. It will not be
			// included in production versions of lessonator.
			// -----------------------------------------------------------------------
			if (options.debugMode) {
				var debugCanvas, debugContext;
				var generateDebugCanvas = function() {
					if (!debugCanvas) {
						if (videoElement._lessonatorDebugCanvas) {
							debugCanvas = videoElement._lessonatorDebugCanvas;
							debugContext = videoElement._lessonatorDebugContext;
						} else {
							debugCanvas = document.createElement("canvas");
							debugCanvas.setAttribute("width",videoMetrics.width);
							debugCanvas.setAttribute("height",videoMetrics.height - videoMetrics.controlHeight);
							document.body.appendChild(debugCanvas);
							lessonator.applyStyles(debugCanvas,{
								"position": "absolute",
								"top": videoMetrics.top + "px",
								"left": videoMetrics.left + "px",
								"width": videoMetrics.width + "px",
								"height": (videoMetrics.height - videoMetrics.controlHeight) + "px",
								"zIndex": 3000
							});
					
							debugContext = debugCanvas.getContext("2d");
							videoElement._lessonatorDebugCanvas = debugCanvas;
							videoElement._lessonatorDebugContext = debugContext;
						}
					}
				};
				
				var clearDebugCanvas = function() {
					generateDebugCanvas();
					debugCanvas.setAttribute("width",videoMetrics.width);
				};
				
				var drawLines = function() {
					var lineIndex;
					
					// Set up canvas for drawing debug information
					generateDebugCanvas();
					
					debugContext.strokeStyle = "rgba(255,0,0,0.5)";
					debugContext.lineWidth = 1;
					
					// Draw horizontal line dividers
					debugContext.beginPath();
					for (lineIndex = 0; lineIndex < videoHeightInLines; lineIndex ++) {
						debugContext.moveTo(0.5,(lineIndex*pixelLineHeight)+0.5);
						debugContext.lineTo(videoMetrics.width,(lineIndex*pixelLineHeight)+0.5);
					}
					
					debugContext.closePath();
					debugContext.stroke();
					debugContext.beginPath();
					debugContext.strokeStyle = "rgba(0,255,0,0.5)";
					
					// Draw vertical line dividers
					// Right to left, vertical
					for (lineIndex = videoWidthInLines; lineIndex >= 0; lineIndex --) {
						debugContext.moveTo((videoMetrics.width-(lineIndex*verticalPixelLineHeight))-0.5,-0.5);
						debugContext.lineTo((videoMetrics.width-(lineIndex*verticalPixelLineHeight))-0.5,videoMetrics.height);
					}
					
					debugContext.closePath();
					debugContext.stroke();
					debugContext.beginPath();
					debugContext.strokeStyle = "rgba(255,255,0,0.5)";
					
					// Draw vertical line dividers
					// Left to right, vertical
					for (lineIndex = 0; lineIndex <= videoWidthInLines; lineIndex ++) {
						debugContext.moveTo((lineIndex*verticalPixelLineHeight)+0.5,-0.5);
						debugContext.lineTo((lineIndex*verticalPixelLineHeight)+0.5,videoMetrics.height);
					}
					
					debugContext.stroke();
					
					videoElement.linesDrawn = true;
				};
				
				var drawAvailableArea = function() {
					generateDebugCanvas();
					
					debugContext.fillStyle = "rgba(100,100,255,0.5)";
					
					debugContext.fillRect(
							videoElement._lessonator_availablePhraseArea.left,
							videoElement._lessonator_availablePhraseArea.top,
							videoElement._lessonator_availablePhraseArea.right,
							videoElement._lessonator_availablePhraseArea.bottom);
					debugContext.stroke();
					
				};
				
				clearDebugCanvas();
				drawAvailableArea();
				drawLines();
			}
			// END DEBUG FUNCTIONS
		},
		/*
			lessonator.stylePhraseCanvas(VideoNode)
		
			Styles and positions a canvas (not a <canvas> object - just a div) for displaying phrases on a video.
			If the HTMLVideoElement in question does not have a canvas, one is created for it.
		
			First parameter: The HTMLVideoElement for which the phrase canvas will be styled/created. This parameter is mandatory.
		
			RETURNS:
		
			Nothing.
		
		*/
		"stylePhraseCanvas": function(videoElement) {
			var baseFontSize, baseLineHeight;
			var containerObject;
			var containerID;
			var options = videoElement._lessonatorOptions instanceof Object ? videoElement._lessonatorOptions : {};
		
			if (!(videoElement instanceof HTMLVideoElement)) {
				throw new Error("Cannot style a phrase canvas for a non-video node!");
			}
			
			if (videoElement._containerObject) {
				containerObject = videoElement._containerObject;
				containerID = containerObject.id;
			}

			if (!containerObject) {
				// visually display captions
				containerObject = document.createElement("div");
				containerObject.className = "lessonator-phrase-canvas";
				containerID = lessonator.generateID();
				containerObject.id = containerID;
				
				// We can choose to append the canvas to an element other than the body.
				// If this option is specified, we no longer use the offsetTop/offsetLeft of the video
				// to define the position, we just inherit it.
				//
				// options.appendPhraseCanvasTo can be an HTMLElement, or a DOM query.
				// If the query fails, the canvas will be appended to the body as normal.
				// If the query is successful, the canvas will be appended to the first matched element.

				if (options.appendPhraseCanvasTo) {
					var canvasParentNode = null;

					if (options.appendPhraseCanvasTo instanceof HTMLElement) {
						canvasParentNode = options.appendPhraseCanvasTo;
					} else if (typeof(options.appendPhraseCanvasTo) === "string") {
						try {
							var canvasSearchResult = document.querySelectorAll(options.appendPhraseCanvasTo);
							if (canvasSearchResult.length > 0) {
								canvasParentNode = canvasSearchResult[0];
							} else { throw null; /* Bounce to catch */ }
						} catch(error) {
							canvasParentNode = document.body;
							options.appendPhraseCanvasTo = false;
						}
					} else {
						canvasParentNode = document.body;
						options.appendPhraseCanvasTo = false;
					}

					canvasParentNode.appendChild(containerObject);
				} else {
					document.body.appendChild(containerObject);
				}

				videoElement._containerObject = containerObject;
				// TODO(silvia): we should only do aria-live on descriptions and that doesn't need visual display
				containerObject.setAttribute("aria-live","polite");
				containerObject.setAttribute("aria-atomic","true");
			} else if (!containerObject.parentNode) {
				document.body.appendChild(containerObject);
			}
		
			// TODO(silvia): we should not really muck with the aria-describedby attribute of the video
			if (String(videoElement.getAttribute("aria-describedby")).indexOf(containerID) === -1) {
				var existingValue = videoElement.hasAttribute("aria-describedby") ? videoElement.getAttribute("aria-describedby") + " " : "";
				videoElement.setAttribute("aria-describedby",existingValue + containerID);
			}
		
			// Set up the phrase canvas
			var videoMetrics = lessonator.getNodeMetrics(videoElement);
		
			// Set up font metrics
			baseFontSize = ((videoMetrics.height * (fontSizeVerticalPercentage/100))/96)*72;
			baseFontSize = baseFontSize >= minimumFontSize ? baseFontSize : minimumFontSize;
			baseLineHeight = Math.floor(baseFontSize * lineHeightRatio);
			baseLineHeight = baseLineHeight > minimumLineHeight ? baseLineHeight : minimumLineHeight;
		
			// Style node!
			lessonator.applyStyles(containerObject,{
				"position": "absolute",
				"overflow": "hidden",
				"zIndex": 100,
				"height": (videoMetrics.height - videoMetrics.controlHeight) + "px",
				"width": videoMetrics.width + "px",
				"top": (options.appendPhraseCanvasTo ? 0 : videoMetrics.top) + "px",
				"left": (options.appendPhraseCanvasTo ? 0 : videoMetrics.left) + "px",
				"color": "white",
				"fontFamily": "Verdana, Helvetica, Arial, sans-serif",
				"fontSize": baseFontSize + "pt",
				"lineHeight": baseLineHeight + "pt",
				"boxSizing": "border-box"
			});
		
			// Defeat a horrid Chrome 10 video bug
			// http://stackoverflow.com/questions/5289854/chrome-10-custom-video-interface-problem/5400438#5400438
			if (window.navigator.userAgent.toLowerCase().indexOf("chrome/10") > -1) {	
				containerObject.style.backgroundColor = "rgba(0,0,0,0.01" + Math.random().toString().replace(".","") + ")";
			}
		},
		/*
			lessonator.parseCaptions(string captionData, object options)
		
			Accepts and parses SRT caption/subtitle data. Will extend for WebVTT shortly. Perhaps non-JSON WebVTT will work already?
			This function has been intended from the start to (hopefully) loosely parse both. I'll patch it as required.
		
			First parameter: Entire text data (UTF-8) of the retrieved SRT/WebVTT file. This parameter is mandatory. (really - what did
			you expect it was going to do without it!)

			Second parameter: lessonator internal options object. See the documentation for allowed values.
		
			RETURNS:
		
			An array of TextLsnPhrase Objects in initial state.
		
		*/
		"parseCaptions": function(captionData, options) {
			// Be liberal in what you accept from others...
			options = options instanceof Object ? options : {};
			var fileType = "", subtitles = [];
			var phraseStyles = "";
			var phraseDefaults = [];
		
			// Set up timestamp parsers - SRT does WebVTT timestamps as well.
			var SUBTimestampParser			= /^(\d{2})?:?(\d{2}):(\d{2})\.(\d+)\,(\d{2})?:?(\d{2}):(\d{2})\.(\d+)\s*(.*)/;
			var SBVTimestampParser			= /^(\d+)?:?(\d{2}):(\d{2})\.(\d+)\,(\d+)?:?(\d{2}):(\d{2})\.(\d+)\s*(.*)/;
			var SRTTimestampParser			= /^(\d{2})?:?(\d{2}):(\d{2})[\.\,](\d+)\s+\-\-\>\s+(\d{2})?:?(\d{2}):(\d{2})[\.\,](\d+)\s*(.*)/;
			var SRTChunkTimestampParser		= /(\d{2})?:?(\d{2}):(\d{2})[\.\,](\d+)/;
			var GoogleTimestampParser		= /^([\d\.]+)\s+\+([\d\.]+)\s*(.*)/;
			var LRCTimestampParser			= /^\[(\d{2})?:?(\d{2})\:(\d{2})\.(\d{2})\]\s*(.*?)$/i;
			var WebVTTDEFAULTSPhraseParser		= /^(DEFAULTS|DEFAULT)\s+\-\-\>\s+(.*)/g;
			var WebVTTSTYLEPhraseParser		= /^(STYLE|STYLES)\s+\-\-\>\s*\n([\s\S]*)/g;
			var WebVTTCOMMENTPhraseParser		= /^(COMMENT|COMMENTS)\s+\-\-\>\s+(.*)/g;

			if (captionData) {
				// This function parses and validates phrase HTML/VTT tokens, and converts them into something understandable to the renderer.
				var processCaptionHTML = function processCaptionHTML(inputHTML) {
					var phraseStructure = new lessonator.lessonatorPhraseStructure(inputHTML,options),
						phraseSplit = [],
						splitIndex,
						currentToken,
						currentContext,
						stack = [],
						stackIndex = 0,
						chunkTimestamp,
						timeData;
					
					var hasRealTextContent = function(textInput) {
						return !!textInput.replace(/[^a-z0-9]+/ig,"").length;
					};
					
					// Process out special phrase spans
					phraseSplit = inputHTML
								.split(/(<\/?[^>]+>)/ig)
								.filter(function(phrasePortionText) {
									return !!phrasePortionText.replace(/\s*/ig,"");
								});
					
					currentContext = phraseStructure;
					for (splitIndex in phraseSplit) {
						if (phraseSplit.hasOwnProperty(splitIndex)) {
							currentToken = phraseSplit[splitIndex];
						
							if (currentToken.substr(0,1) === "<") {
								if (currentToken.substr(1,1) === "/") {
									// Closing tag
									var TagName = currentToken.substr(2).split(/[\s>]+/g)[0];
									if (stack.length > 0) {
										// Scan backwards through the stack to determine whether we've got an open tag somewhere to close.
										var stackScanDepth = 0;
										for (stackIndex = stack.length-1; stackIndex >= 0; stackIndex --) {
											var parentContext = stack[stackIndex][stack[stackIndex].length-1];
											stackScanDepth = stackIndex;
											if (parentContext.token === TagName) { break; }
										}
									
										currentContext = stack[stackScanDepth];
										stack = stack.slice(0,stackScanDepth);
									} else {
										// Tag mismatch!
									}
								} else {
									// Opening Tag
									// Check whether the tag is valid according to the WebVTT specification
									// If not, don't allow it (unless the sanitisePhraseHTML option is explicitly set to false)
								
									if ((	currentToken.substr(1).match(SRTChunkTimestampParser)	||
											currentToken.match(/^<v\s+[^>]+>/i)						||
											currentToken.match(/^<c[a-z0-9\-\_\.]+>/)				||
											currentToken.match(/^<(b|i|u|ruby|rt)>/))				||
										options.sanitisePhraseHTML !== false) {
										
										var tmpObject = {
											"token":	currentToken.replace(/[<\/>]+/ig,"").split(/[\s\.]+/)[0],
											"rawToken":	currentToken,
											"children":	[]
										};
										
										if (tmpObject.token === "v") {
											tmpObject.voice = currentToken.match(/^<v\s*([^>]+)>/i)[1];
										} else if (tmpObject.token === "c") {
											tmpObject.classes = currentToken
																	.replace(/[<\/>\s]+/ig,"")
																	.split(/[\.]+/ig)
																	.slice(1)
																	.filter(hasRealTextContent);
										} else if (!!(chunkTimestamp = tmpObject.rawToken.match(SRTChunkTimestampParser))) {
											phraseStructure.isTimeDependent = true;
											timeData = chunkTimestamp.slice(1);
											tmpObject.timeIn =	parseInt((timeData[0]||0) * 60 * 60,10) +	// Hours
																parseInt((timeData[1]||0) * 60,10) +		// Minutes
																parseInt((timeData[2]||0),10) +				// Seconds
																parseFloat("0." + (timeData[3]||0));		// MS
										}
									
										currentContext.push(tmpObject);
										stack.push(currentContext);
										currentContext = tmpObject.children;
									}
								}
							} else {
								// Text string
								if (options.sanitisePhraseHTML !== false) {
									currentToken = currentToken
													.replace(/</g,"&lt;")
													.replace(/>/g,"&gt;")
													.replace(/\&/g,"&amp;");
									
									if (!options.ignoreWhitespace) {
										currentToken = currentToken.replace(/\n+/g,"<br />");
									}
								}
							
								currentContext.push(currentToken);
							}
						}
					}

					return phraseStructure;
				};
				
				// This function takes chunks of text representing phrases, and converts them into phrase objects.
				var parseCaptionChunk = function parseCaptionChunk(subtitleElement,objectCount) {
					var subtitleParts, timeIn, timeOut, html, timeData, subtitlePartIndex, phraseSettings = "", id, specialPhraseData;
					var timestampMatch, tmpPhrase;

					// WebVTT Special Phrase Logic
					if ((specialPhraseData = WebVTTDEFAULTSPhraseParser.exec(subtitleElement))) {
						phraseDefaults = specialPhraseData.slice(2).join("");
						phraseDefaults = phraseDefaults.split(/\s+/g).filter(function(def) { return def && !!def.length; });
						return null;
					} else if ((specialPhraseData = WebVTTSTYLEPhraseParser.exec(subtitleElement))) {
						phraseStyles += specialPhraseData[specialPhraseData.length-1];
						return null;
					} else if ((specialPhraseData = WebVTTCOMMENTPhraseParser.exec(subtitleElement))) {
						return null; // At this stage, we don't want to do anything with these.
					}
					
					if (fileType === "LRC") {
						subtitleParts = [
							subtitleElement.substr(0,subtitleElement.indexOf("]")),
							subtitleElement.substr(subtitleElement.indexOf("]")+1)
						];
					} else {
						subtitleParts = subtitleElement.split(/\n/g);
					}
				
					// Trim off any blank lines (logically, should only be max. one, but loop to be sure)
					while (!subtitleParts[0].replace(/\s+/ig,"").length && subtitleParts.length > 0) {
						subtitleParts.shift();
					}
				
					if (subtitleParts[0].match(/^\s*[a-z0-9]+\s*$/ig)) {
						// The identifier becomes the phrase ID (when *we* load the phrases from file. Programatically created phrases can have an ID of whatever.)
						id = String(subtitleParts.shift().replace(/\s*/ig,""));
					} else {
						// We're not parsing a format with an ID prior to each caption like SRT or WebVTT
						id = objectCount;
					}
				
					for (subtitlePartIndex = 0; subtitlePartIndex < subtitleParts.length; subtitlePartIndex ++) {
						var timestamp = subtitleParts[subtitlePartIndex];
						
						if ((timestampMatch = SRTTimestampParser.exec(timestamp)) ||
							(timestampMatch = SUBTimestampParser.exec(timestamp)) ||
							(timestampMatch = SBVTimestampParser.exec(timestamp))) {
							
							// WebVTT / SRT / SUB (VOBSub) / YouTube SBV style timestamp
							
							timeData = timestampMatch.slice(1);
							
							timeIn =	parseInt((timeData[0]||0) * 60 * 60,10) +	// Hours
										parseInt((timeData[1]||0) * 60,10) +		// Minutes
										parseInt((timeData[2]||0),10) +				// Seconds
										parseFloat("0." + (timeData[3]||0));		// MS
							
							timeOut =	parseInt((timeData[4]||0) * 60 * 60,10) +	// Hours
										parseInt((timeData[5]||0) * 60,10) +		// Minutes
										parseInt((timeData[6]||0),10) +				// Seconds
										parseFloat("0." + (timeData[7]||0));		// MS
							
							if (timeData[8]) {
								phraseSettings = timeData[8];
							}
					
						} else if (!!(timestampMatch = GoogleTimestampParser.exec(timestamp))) {
							
							// Google's proposed WebVTT timestamp style
							timeData = timestampMatch.slice(1);
							
							timeIn = parseFloat(timeData[0]);
							timeOut = timeIn + parseFloat(timeData[1]);

							if (timeData[2]) {
								phraseSettings = timeData[2];
							}
						}
						
						// We've got the timestamp - return all the other unmatched lines as the raw subtitle data
						subtitleParts = subtitleParts.slice(0,subtitlePartIndex).concat(subtitleParts.slice(subtitlePartIndex+1));
						break;
					}

					if (!timeIn && !timeOut) {
						// We didn't extract any time information. Assume the phrase is invalid!
						return null;
					}

					// Consolidate phrase settings, convert defaults to object
					var compositePhraseSettings =
						phraseDefaults
							.reduce(function(previous,current,index,array){
								previous[current.split(":")[0]] = current.split(":")[1];
								return previous;
							},{});
					
					// Loop through phrase settings, replace defaults with phrase specific settings if they exist
					compositePhraseSettings =
						phraseSettings
							.split(/\s+/g)
							.filter(function(set) { return set && !!set.length; })
							// Convert array to a key/val object
							.reduce(function(previous,current,index,array){
								previous[current.split(":")[0]] = current.split(":")[1];
								return previous;
							},compositePhraseSettings);
					
					// Turn back into string like the TextLsnPhrase constructor expects
					phraseSettings = "";
					for (var key in compositePhraseSettings) {
						if (compositePhraseSettings.hasOwnProperty(key)) {
							phraseSettings += !!phraseSettings.length ? " " : "";
							phraseSettings += key + ":" + compositePhraseSettings[key];
						}
					}
					
					// The remaining lines are the subtitle payload itself (after removing an ID if present, and the time);
					html = options.processPhraseHTML === false ? subtitleParts.join("\n") : processCaptionHTML(subtitleParts.join("\n"));
					tmpPhrase = new lessonator.TextLsnPhrase(id, timeIn, timeOut, html, phraseSettings, false, null);
					tmpPhrase.styleData = phraseStyles;
					return tmpPhrase;
				};
				
				// Begin parsing --------------------
				subtitles = captionData
								.replace(/\r\n/g,"\n")
								.replace(/\r/g,"\n");
			
				if (LRCTimestampParser.exec(captionData)) {
					// LRC file... split by single line
					subtitles = subtitles.split(/\n+/g);
					fileType = "LRC";
				} else {
					subtitles = subtitles.split(/\n\n+/g);
				}
			
				subtitles = subtitles.filter(function(lineGroup) {
									if (lineGroup.match(/^WEBVTT(\s*FILE)?/ig)) {
										fileType = "WebVTT";
										return false;
									} else {
										if (lineGroup.replace(/\s*/ig,"").length) {
											return true;
										}
										return false;
									}
								})
								.map(parseCaptionChunk)
								.filter(function(phrase) {
									// In the parseCaptionChunk function, we return null for special and malformed phrases,
									// and phrases we want to ignore, rather than expose to JS. Filter these out now.
									if (phrase !== null) {
										return true;
									}

									return false;
								});
				
				return subtitles;
			} else {
				throw new Error("Required parameter captionData not supplied.");
			}
		}
	};
	
	window.lessonator = lessonator;
})();

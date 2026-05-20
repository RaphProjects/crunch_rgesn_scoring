/*
 * Copyright (C) 2015 - 2018 Kosmos contact@kosmos.fr
 *
 * Projet: frontgen
 * Version: 7.1.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function() {
    'use strict';

    let callbacks = [];

    window.collapsableCommons = {
        // Hide every opened menu
        hideAll: function (exceptions) {
            let opened = document.querySelectorAll('.plier-deplier__contenu--ouvert');

            // Filters exceptions
            if (typeof exceptions === 'string') {
                opened = Array.prototype.filter.call(opened, function(selectedElement) {
                    return !selectedElement.classList.contains(exceptions);
                });
            } else if (Object.prototype.toString.call(exceptions) === '[object Array]') {
                opened = exceptions.forEach(exception => Array.prototype.filter.call(opened, function(selectedElement) {
                    return !selectedElement.classList.contains(exception);
                }));
            } else if (Object.prototype.toString.call(exceptions) === '[object Function]') {
                opened = Array.prototype.filter.call(opened, exceptions);
            }

            // Handles states
            opened.forEach(element => {
                element.classList.remove('plier-deplier__contenu--ouvert');
                element.classList.add('plier-deplier__contenu--clos');
                let buttons = element.parentNode.getElementsByClassName('plier-deplier__bouton');
                if (buttons[0]) {
                    buttons[0].setAttribute('aria-expanded', true);
                }
            });

            callbacks.forEach(function(callback) {
                callback()
            });
        },
        registerCallback: function (callback) {
            if (callback && {}.toString.call(callback) === '[object Function]') {
                callbacks.push(callback);
            }
        }
    };

    let foldUnfoldElements = document.querySelectorAll('.plier-deplier');

    /**
     * Handles default menu behaviors.
     */
    // Handle click and focusin events outside menus to close them
    document.documentElement.addEventListener('click', function() {
        collapsableCommons.hideAll('plier-deplier__contenu--relatif')
    });

    // Handle click and focusin events so it doesn't bubble to the html element
    document.querySelectorAll('.plier-deplier__contenu').forEach(function(element) {
        element.addEventListener('click', function(e) {
            e.stopPropagation();
        })
    });

    foldUnfoldElements.forEach(function(element) {
        element.addEventListener('focus', function(e) {
            e.stopPropagation();
        })
    });

    // CrÃ©ation de la liste des Ã©lÃ©ments Ã  gÃ©rer
    let buttonList = Array.prototype.filter.call(foldUnfoldElements, function(selectedElement) {
        return !selectedElement.classList.contains('plier-deplier__contenu--relatif');
    });
    let buttonList2 = Array.prototype.filter.call(document.getElementsByClassName('plier-deplier__bouton'),
        function(selectedElement) {
                    return selectedElement.id !== 'menu-principal-bouton';
                });
    buttonList.concat(buttonList2).forEach(function (element) {
        element.addEventListener('click', foldUnfold)
    });

    /**
     * Fonction d'ouverture/fermeture des contenus gÃ©rÃ©s.
     * @param element l'Ã©lÃ©ment qui a pris le clique
     */
    function foldUnfold(element) {
        element.preventDefault();
        element.stopPropagation();

        let foldUnfoldGroup = this.dataset['plierdeplierGroup'];
        let contents = this.parentNode.getElementsByClassName('plier-deplier__contenu');
        if (foldUnfoldGroup) {
            contents = Array.prototype.filter.call(contents, function(selectedElement) {
                return filterByElementGroupData(selectedElement, foldUnfoldGroup);
            });
        }
        let haveToClose = true;
        for (let i = 0; i < contents.length; i++) {
            haveToClose &= contents[i].classList.contains('plier-deplier__contenu--ouvert');
            contents[i].classList.toggle('plier-deplier__contenu--clos');
            contents[i].classList.toggle('plier-deplier__contenu--ouvert');
        }
        if (haveToClose) {
            if (foldUnfoldGroup) {
                collapsableCommons.hideAll(function(selectedElement) {
                    return filterByElementGroupData(selectedElement, foldUnfoldGroup);
                });
            } else {
                collapsableCommons.hideAll();
            }
        }
    }

    /**
     * Permet de filtrer sur les Ã©lÃ©ments sÃ©lectionnÃ©.
     * Le filtre s'applique sur les Ã©lÃ©ments possÃ©dant le mÃªme data-attribute "plierdeplier-group".
     * @param selectedElement l'Ã©lÃ©ment sÃ©lectionnÃ©
     * @param group le groupe d'application
     * @return {boolean} true si l'Ã©lÃ©ment est acceptÃ©
     */
    function filterByElementGroupData(selectedElement, group) {
        return selectedElement.dataset['plierdeplierGroup'] === group;
    }

})();
